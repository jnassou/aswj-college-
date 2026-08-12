-- Migration 013 made workflows atomic, but its already-deployed first version had
-- three follow-up integrity gaps: a no-op Accepted decision cleared enrolment lifecycle
-- boundaries, application transitions retained stale attendance reviews, and attendance
-- notifications could be suppressed across review episodes or originate from an
-- ineligible session. Repair those behaviours without rewriting deployed migrations.

alter function public.admin_decide_application(uuid, text, text)
rename to admin_decide_application_v1;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

alter function public.admin_decide_application_v1(uuid, text, text)
set schema private;

revoke all on function private.admin_decide_application_v1(uuid, text, text)
from public, anon, authenticated;
grant execute on function private.admin_decide_application_v1(uuid, text, text)
to authenticated;

create or replace function public.admin_decide_application(
  p_application_id uuid,
  p_decision text,
  p_note text default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_class_id uuid;
  v_student_id uuid;
  v_old_status public.application_status;
  v_old_waitlist_position integer;
  v_enrolment_status public.enrolment_status;
  v_now timestamptz := now();
begin
  if v_actor is null
     or coalesce(auth.jwt()->'app_metadata'->>'role', '')
       not in ('admin', 'super_admin') then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  select a.class_id
  into v_class_id
  from public.applications a
  where a.id = p_application_id;

  if v_class_id is null then
    raise exception 'Application not found';
  end if;

  perform 1
  from public.classes c
  where c.id = v_class_id
  for update;

  if not found then
    raise exception 'Class not found';
  end if;

  select a.student_id, a.status, a.waitlist_position
  into v_student_id, v_old_status, v_old_waitlist_position
  from public.applications a
  where a.id = p_application_id
  for update;

  if not found then
    raise exception 'Application not found';
  end if;

  select e.status
  into v_enrolment_status
  from public.enrolments e
  where e.student_id = v_student_id
    and e.class_id = v_class_id
  for update;

  if p_decision = 'accepted'
     and v_old_status = 'accepted'::public.application_status
     and v_enrolment_status in (
       'enrolled'::public.enrolment_status,
       'suspended'::public.enrolment_status
     ) then
    update public.applications
    set waitlist_position = null,
        reviewed_by = v_actor,
        reviewed_at = v_now,
        admin_notes = nullif(btrim(p_note), '')
    where id = p_application_id;

    insert into public.audit_log (
      actor_id,
      entity_type,
      entity_id,
      action,
      old_values,
      new_values
    ) values (
      v_actor,
      'application',
      p_application_id::text,
      'application_accepted',
      jsonb_build_object(
        'status', v_old_status,
        'waitlist_position', v_old_waitlist_position
      ),
      jsonb_build_object(
        'status', v_old_status,
        'waitlist_position', null,
        'reviewed_at', v_now,
        'admin_notes', nullif(btrim(p_note), '')
      )
    );

    return;
  end if;

  perform private.admin_decide_application_v1(
    p_application_id,
    p_decision,
    p_note
  );

  -- Every delegated path is a state transition or enrolment reconciliation. End an
  -- open review from the previous application/enrolment lifecycle in the same transaction.
  update public.suspension_reviews sr
  set status = 'closed',
      reviewed_by = v_actor,
      reviewed_at = v_now,
      review_note = coalesce(
        sr.review_note,
        'Closed after application status change'
      )
  where sr.enrolment_id = (
    select e.id
    from public.enrolments e
    where e.student_id = v_student_id
      and e.class_id = v_class_id
  )
    and sr.status = 'open';
end;
$$;

revoke execute on function public.admin_decide_application(uuid, text, text)
from public, anon;
grant execute on function public.admin_decide_application(uuid, text, text)
to authenticated;

create or replace function public.queue_attendance_portal_notice()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student_id uuid;
  v_enrolment_status public.enrolment_status;
  v_reviewed_through date;
  v_session_date date;
  v_streak bigint;
  v_threshold integer;
  v_template text;
  v_dedupe_since timestamptz;
begin
  if new.status is distinct from 'absent_unexcused'::public.attendance_status then
    return null;
  end if;

  if tg_op = 'UPDATE'
     and old.status = 'absent_unexcused'::public.attendance_status then
    return null;
  end if;

  select
    e.student_id,
    e.status,
    e.attendance_reviewed_through,
    c.absence_threshold,
    cs.session_date
  into
    v_student_id,
    v_enrolment_status,
    v_reviewed_through,
    v_threshold,
    v_session_date
  from public.enrolments e
  join public.classes c on c.id = e.class_id
  join public.class_sessions cs
    on cs.id = new.session_id
   and cs.class_id = e.class_id
   and cs.cancelled = false
  where e.id = new.enrolment_id
    and cs.session_date >= greatest(
      (e.enrolled_at at time zone 'Australia/Sydney')::date,
      coalesce(
        (e.reinstated_at at time zone 'Australia/Sydney')::date,
        (e.enrolled_at at time zone 'Australia/Sydney')::date
      )
    )
    and cs.session_date <= (now() at time zone 'Australia/Sydney')::date;

  if v_student_id is null
     or v_enrolment_status is distinct from 'enrolled'::public.enrolment_status
     or (v_reviewed_through is not null and v_session_date <= v_reviewed_through) then
    return null;
  end if;

  v_streak := public.attendance_consecutive_absences(new.enrolment_id);

  if v_streak >= v_threshold then
    v_template := 'attendance_review_required';
  elsif v_streak = greatest(v_threshold - 1, 1) then
    v_template := 'attendance_warning';
  else
    return null;
  end if;

  -- Keep the normal 14-day noise guard, but begin a fresh dedupe window after the
  -- latest resolved review so a genuinely new review episode is always announced.
  select greatest(
    now() - interval '14 days',
    coalesce(max(sr.reviewed_at), '-infinity'::timestamptz)
  )
  into v_dedupe_since
  from public.suspension_reviews sr
  where sr.enrolment_id = new.enrolment_id
    and sr.status <> 'open'
    and sr.reviewed_at is not null;

  if not exists (
    select 1
    from public.notifications n
    where n.student_id = v_student_id
      and n.enrolment_id = new.enrolment_id
      and n.template_key = v_template
      and n.created_at > v_dedupe_since
  ) then
    insert into public.notifications (
      student_id,
      enrolment_id,
      channel,
      template_key,
      status
    ) values (
      v_student_id,
      new.enrolment_id,
      'portal',
      v_template,
      'queued'
    );
  end if;

  return null;
end;
$$;

revoke execute on function public.queue_attendance_portal_notice()
from public, anon, authenticated;

-- Keep the shared session helper callable only by administrators, and make its
-- own session mutation auditable even when it is invoked directly.
create or replace function public.admin_today_session(
  p_class_id uuid
)
returns table (
  session_id uuid,
  session_cancelled boolean,
  session_starts_at timestamptz,
  session_ends_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_today date := (now() at time zone 'Australia/Sydney')::date;
  v_active boolean;
  v_start_time time;
  v_end_time time;
  v_session_existed boolean;
  v_old_starts_at timestamptz;
  v_old_ends_at timestamptz;
begin
  if v_actor is null
     or coalesce(auth.jwt()->'app_metadata'->>'role', '')
       not in ('admin', 'super_admin') then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  select c.active, c.start_time, c.end_time
  into v_active, v_start_time, v_end_time
  from public.classes c
  where c.id = p_class_id
  for update;

  if not found then
    raise exception 'Class not found';
  end if;
  if not v_active then
    raise exception 'This class is archived';
  end if;

  session_starts_at := case
    when v_start_time is null then null
    else (v_today + v_start_time) at time zone 'Australia/Sydney'
  end;
  session_ends_at := case
    when v_end_time is null then null
    else (v_today + v_end_time) at time zone 'Australia/Sydney'
  end;

  select cs.starts_at, cs.ends_at
  into v_old_starts_at, v_old_ends_at
  from public.class_sessions cs
  where cs.class_id = p_class_id
    and cs.session_date = v_today
  for update;
  v_session_existed := found;

  insert into public.class_sessions as existing (
    class_id,
    session_date,
    starts_at,
    ends_at,
    cancelled
  ) values (
    p_class_id,
    v_today,
    session_starts_at,
    session_ends_at,
    false
  )
  on conflict (class_id, session_date)
  do update set
    starts_at = coalesce(existing.starts_at, excluded.starts_at),
    ends_at = coalesce(existing.ends_at, excluded.ends_at)
  returning
    existing.id,
    existing.cancelled,
    existing.starts_at,
    existing.ends_at
  into
    session_id,
    session_cancelled,
    session_starts_at,
    session_ends_at;

  if not v_session_existed
     or v_old_starts_at is distinct from session_starts_at
     or v_old_ends_at is distinct from session_ends_at then
    insert into public.audit_log (
      actor_id,
      entity_type,
      entity_id,
      action,
      old_values,
      new_values
    ) values (
      v_actor,
      'class_session',
      session_id::text,
      case
        when v_session_existed then 'class_session_schedule_synced'
        else 'class_session_created'
      end,
      case
        when v_session_existed then jsonb_build_object(
          'starts_at', v_old_starts_at,
          'ends_at', v_old_ends_at
        )
        else '{}'::jsonb
      end,
      jsonb_build_object(
        'class_id', p_class_id,
        'session_date', v_today,
        'starts_at', session_starts_at,
        'ends_at', session_ends_at
      )
    );
  end if;

  return next;
end;
$$;

revoke execute on function public.admin_today_session(uuid)
from public, anon;
grant execute on function public.admin_today_session(uuid)
to authenticated;

-- Make review materialisation retry-safe and usable by its explicitly trusted
-- service-role caller.
create or replace function public.open_required_suspension_reviews()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  inserted_count integer;
begin
  if current_user not in ('postgres', 'service_role', 'supabase_admin')
     and coalesce(auth.jwt()->>'role', '') <> 'service_role'
     and coalesce(auth.jwt()->'app_metadata'->>'role', '')
       not in ('admin', 'super_admin') then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  insert into public.suspension_reviews (enrolment_id, consecutive_absences)
  select v.enrolment_id, v.consecutive_absences
  from public.students_requiring_attendance_review v
  where not exists (
    select 1
    from public.suspension_reviews sr
    where sr.enrolment_id = v.enrolment_id
      and sr.status = 'open'
  )
  on conflict (enrolment_id) where status = 'open'
  do update set consecutive_absences = excluded.consecutive_absences;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

revoke execute on function public.open_required_suspension_reviews()
from public, anon;
grant execute on function public.open_required_suspension_reviews()
to authenticated, service_role;

-- Application ownership/classification and attendance ownership are identity fields,
-- not editable workflow fields. Keeping them immutable removes cross-class races and
-- prevents an attendance row from being reassigned around its audit history.
create or replace function public.protect_application_identity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.student_id is distinct from old.student_id
     or new.class_id is distinct from old.class_id then
    raise exception 'An application cannot be moved to another student or class';
  end if;
  return new;
end;
$$;

revoke execute on function public.protect_application_identity()
from public, anon, authenticated;

drop trigger if exists applications_protect_identity on public.applications;
create trigger applications_protect_identity
before update on public.applications
for each row execute function public.protect_application_identity();

create or replace function public.validate_attendance_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enrolment_class_id uuid;
  v_session_class_id uuid;
begin
  if tg_op = 'UPDATE'
     and (
       new.enrolment_id is distinct from old.enrolment_id
       or new.session_id is distinct from old.session_id
     ) then
    raise exception 'An attendance record cannot be moved to another enrolment or session';
  end if;

  select e.class_id
  into v_enrolment_class_id
  from public.enrolments e
  where e.id = new.enrolment_id;

  select cs.class_id
  into v_session_class_id
  from public.class_sessions cs
  where cs.id = new.session_id;

  if v_enrolment_class_id is null or v_session_class_id is null then
    raise exception 'Attendance requires an existing enrolment and session';
  end if;
  if v_enrolment_class_id <> v_session_class_id then
    raise exception 'Attendance enrolment and session must belong to the same class';
  end if;

  return new;
end;
$$;

revoke execute on function public.validate_attendance_identity()
from public, anon, authenticated;

drop trigger if exists attendance_validate_identity on public.attendance;
drop trigger if exists attendance_00_validate_identity on public.attendance;
create trigger attendance_00_validate_identity
before insert or update on public.attendance
for each row execute function public.validate_attendance_identity();

-- Serialize attendance changes for one enrolment so concurrent direct/service writes
-- cannot each observe a partial streak and miss the final warning/review threshold.
create or replace function public.lock_attendance_enrolment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enrolment_id uuid;
begin
  v_enrolment_id := case
    when tg_op = 'DELETE' then old.enrolment_id
    else new.enrolment_id
  end;

  perform 1
  from public.enrolments e
  where e.id = v_enrolment_id
  for update;

  if not found then
    raise exception 'Enrolment not found';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke execute on function public.lock_attendance_enrolment()
from public, anon, authenticated;

drop trigger if exists attendance_lock_enrolment on public.attendance;
drop trigger if exists attendance_01_lock_enrolment on public.attendance;
create trigger attendance_01_lock_enrolment
before insert or update or delete on public.attendance
for each row execute function public.lock_attendance_enrolment();
