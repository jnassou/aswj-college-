-- Student application and attendance state transitions must commit with their audit
-- and portal-notification side effects. This migration also makes a closed roll the
-- sole source of absence truth: missing attendance rows are never inferred as absences.

alter table public.enrolments
  add column if not exists attendance_reviewed_through date;

-- Preserve the intent of any previously completed "keep enrolled" reviews.
update public.enrolments e
set attendance_reviewed_through = (
  select max(cs.session_date)
  from public.suspension_reviews sr
  join public.attendance a on a.enrolment_id = sr.enrolment_id
  join public.class_sessions cs on cs.id = a.session_id
  where sr.enrolment_id = e.id
    and sr.status = 'kept_enrolled'
    and sr.reviewed_at is not null
    and a.status = 'absent_unexcused'::public.attendance_status
    and cs.cancelled = false
    and cs.session_date <= (sr.reviewed_at at time zone 'Australia/Sydney')::date
)
where exists (
  select 1
  from public.suspension_reviews sr
  where sr.enrolment_id = e.id
    and sr.status = 'kept_enrolled'
    and sr.reviewed_at is not null
);

create or replace function public.attendance_consecutive_absences(
  p_enrolment_id uuid
)
returns bigint
language sql
stable
security invoker
set search_path = ''
as $$
  with enrolment_class as (
    select
      e.class_id,
      greatest(
        (e.enrolled_at at time zone 'Australia/Sydney')::date,
        coalesce(
          (e.reinstated_at at time zone 'Australia/Sydney')::date,
          (e.enrolled_at at time zone 'Australia/Sydney')::date
        )
      ) as eligible_on
    from public.enrolments e
    where e.id = p_enrolment_id
  ), ordered as (
    select
      a.status,
      row_number() over (
        order by cs.session_date desc, a.updated_at desc, a.id desc
      ) as rn
    from public.attendance a
    join public.class_sessions cs on cs.id = a.session_id
    join enrolment_class ec
      on ec.class_id = cs.class_id
    where a.enrolment_id = p_enrolment_id
      and cs.cancelled = false
      and cs.session_date >= ec.eligible_on
      and cs.session_date <= (now() at time zone 'Australia/Sydney')::date
  ), first_break as (
    select min(rn) filter (
      where status is distinct from 'absent_unexcused'::public.attendance_status
    ) as break_rn
    from ordered
  )
  select count(*)
  from ordered, first_break
  where status = 'absent_unexcused'::public.attendance_status
    and rn < coalesce(break_rn, 2147483647::bigint);
$$;

revoke execute on function public.attendance_consecutive_absences(uuid)
from public, anon;
grant execute on function public.attendance_consecutive_absences(uuid)
to authenticated, service_role;

create or replace function public.attendance_latest_unexcused_date(
  p_enrolment_id uuid
)
returns date
language sql
stable
security invoker
set search_path = ''
as $$
  select max(cs.session_date)
  from public.enrolments e
  join public.attendance a on a.enrolment_id = e.id
  join public.class_sessions cs
    on cs.id = a.session_id
   and cs.class_id = e.class_id
  where e.id = p_enrolment_id
    and a.status = 'absent_unexcused'::public.attendance_status
    and cs.cancelled = false
    and cs.session_date >= greatest(
      (e.enrolled_at at time zone 'Australia/Sydney')::date,
      coalesce(
        (e.reinstated_at at time zone 'Australia/Sydney')::date,
        (e.enrolled_at at time zone 'Australia/Sydney')::date
      )
    )
    and cs.session_date <= (now() at time zone 'Australia/Sydney')::date;
$$;

revoke execute on function public.attendance_latest_unexcused_date(uuid)
from public, anon;
grant execute on function public.attendance_latest_unexcused_date(uuid)
to authenticated, service_role;

create or replace view public.student_attendance_streaks
with (security_invoker = true)
as
select
  e.id as enrolment_id,
  e.student_id,
  e.class_id,
  streak.consecutive_absences,
  c.absence_threshold,
  case
    when streak.consecutive_absences >= c.absence_threshold
      and (
        e.attendance_reviewed_through is null
        or latest.session_date > e.attendance_reviewed_through
      ) then 'review_required'
    when streak.consecutive_absences = greatest(c.absence_threshold - 1, 1)
      and (
        e.attendance_reviewed_through is null
        or latest.session_date > e.attendance_reviewed_through
      ) then 'warning'
    else 'ok'
  end as review_state
from public.enrolments e
join public.classes c on c.id = e.class_id
cross join lateral (
  select public.attendance_consecutive_absences(e.id) as consecutive_absences
) streak
cross join lateral (
  select public.attendance_latest_unexcused_date(e.id) as session_date
) latest
where e.status = 'enrolled'::public.enrolment_status;

grant select on public.student_attendance_streaks
to authenticated, service_role;

create or replace view public.students_requiring_attendance_review
with (security_invoker = true)
as
select
  enrolment_id,
  student_id,
  class_id,
  consecutive_absences,
  absence_threshold
from public.student_attendance_streaks
where review_state = 'review_required';

grant select on public.students_requiring_attendance_review
to authenticated, service_role;

create or replace function public.refresh_attendance_suspension_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enrolment_id uuid;
  v_streak bigint;
  v_threshold integer;
  v_status public.enrolment_status;
  v_reviewed_through date;
  v_latest_absence date;
begin
  if tg_op = 'DELETE' then
    v_enrolment_id := old.enrolment_id;
  else
    v_enrolment_id := new.enrolment_id;
  end if;

  select e.status, e.attendance_reviewed_through, c.absence_threshold
  into v_status, v_reviewed_through, v_threshold
  from public.enrolments e
  join public.classes c on c.id = e.class_id
  where e.id = v_enrolment_id;

  if v_status is distinct from 'enrolled'::public.enrolment_status then
    return null;
  end if;

  v_streak := public.attendance_consecutive_absences(v_enrolment_id);
  v_latest_absence := public.attendance_latest_unexcused_date(v_enrolment_id);

  if v_streak >= v_threshold
     and (
       v_reviewed_through is null
       or v_latest_absence > v_reviewed_through
     ) then
    insert into public.suspension_reviews (
      enrolment_id,
      consecutive_absences,
      status
    ) values (
      v_enrolment_id,
      v_streak::integer,
      'open'
    )
    on conflict (enrolment_id) where status = 'open'
    do update set consecutive_absences = excluded.consecutive_absences;
  else
    update public.suspension_reviews
    set status = 'closed',
        reviewed_at = now(),
        review_note = coalesce(
          review_note,
          'Attendance streak cleared automatically'
        )
    where enrolment_id = v_enrolment_id
      and status = 'open';
  end if;

  return null;
end;
$$;

revoke execute on function public.refresh_attendance_suspension_review()
from public, anon, authenticated;

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

drop trigger if exists attendance_queue_portal_notice on public.attendance;
create trigger attendance_queue_portal_notice
after insert or update on public.attendance
for each row execute function public.queue_attendance_portal_notice();

-- Reconcile the migration-006 definitions on already-deployed projects while keeping
-- authorization based on trusted Auth app metadata.
drop policy if exists audit_log_admin_insert on public.audit_log;
create policy audit_log_admin_insert
on public.audit_log for insert to authenticated
with check (
  coalesce((select auth.jwt()->'app_metadata'->>'role'), '')
    in ('admin', 'super_admin')
  and actor_id = (select auth.uid())
);

grant select on table public.audit_log to authenticated;
drop policy if exists audit_log_admin_select on public.audit_log;
create policy audit_log_admin_select
on public.audit_log for select to authenticated
using (
  coalesce((select auth.jwt()->'app_metadata'->>'role'), '')
    in ('admin', 'super_admin')
);

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

create or replace function public.prevent_unauthorized_profile_role_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.role is distinct from old.role
     and coalesce(auth.jwt()->'app_metadata'->>'role', '')
       not in ('admin', 'super_admin') then
    raise exception 'Only an administrator may change a profile role'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function public.prevent_unauthorized_profile_role_change()
from public, anon, authenticated;

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

drop trigger if exists attendance_00_validate_identity on public.attendance;
create trigger attendance_00_validate_identity
before insert or update on public.attendance
for each row execute function public.validate_attendance_identity();

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

drop trigger if exists attendance_01_lock_enrolment on public.attendance;
create trigger attendance_01_lock_enrolment
before insert or update or delete on public.attendance
for each row execute function public.lock_attendance_enrolment();

create unique index if not exists applications_waitlist_position_unique_idx
on public.applications(class_id, waitlist_position)
where status = 'waitlisted'::public.application_status
  and waitlist_position is not null;

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
  v_decision public.application_status;
  v_changed boolean;
  v_capacity integer;
  v_class_active boolean;
  v_class_name text;
  v_other_active_count integer;
  v_waitlist_position integer;
  v_enrolment_status public.enrolment_status;
  v_now timestamptz := now();
begin
  if v_actor is null
     or coalesce(auth.jwt()->'app_metadata'->>'role', '')
       not in ('admin', 'super_admin') then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  if p_decision not in ('accepted', 'waitlisted', 'declined') then
    raise exception 'Unsupported application decision';
  end if;
  v_decision := p_decision::public.application_status;

  select a.class_id
  into v_class_id
  from public.applications a
  where a.id = p_application_id;

  if v_class_id is null then
    raise exception 'Application not found';
  end if;

  select c.capacity, c.active, c.name
  into v_capacity, v_class_active, v_class_name
  from public.classes c
  where c.id = v_class_id
  for update;

  if not found then
    raise exception 'Class not found';
  end if;

  select a.student_id, a.class_id, a.status, a.waitlist_position
  into v_student_id, v_class_id, v_old_status, v_old_waitlist_position
  from public.applications a
  where a.id = p_application_id
  for update;

  if not found then
    raise exception 'Application not found';
  end if;

  v_changed := v_old_status is distinct from v_decision;

  select e.status
  into v_enrolment_status
  from public.enrolments e
  where e.student_id = v_student_id
    and e.class_id = v_class_id
  for update;

  if v_decision = 'accepted'::public.application_status then
    if not v_class_active then
      raise exception 'This class is archived and cannot accept new students';
    end if;

    select count(*)::integer
    into v_other_active_count
    from public.enrolments e
    where e.class_id = v_class_id
      and e.student_id <> v_student_id
      and e.status in (
        'enrolled'::public.enrolment_status,
        'suspended'::public.enrolment_status
      );

    if v_other_active_count >= v_capacity then
      raise exception '% is full. Put this student on the waiting list instead',
        v_class_name;
    end if;
  elsif v_decision = 'waitlisted'::public.application_status then
    if v_old_status = 'waitlisted'::public.application_status
       and v_old_waitlist_position is not null then
      v_waitlist_position := v_old_waitlist_position;
    else
      select coalesce(max(a.waitlist_position), 0) + 1
      into v_waitlist_position
      from public.applications a
      where a.class_id = v_class_id
        and a.status = 'waitlisted'::public.application_status;
    end if;
  end if;

  update public.applications
  set status = v_decision,
      waitlist_position = v_waitlist_position,
      reviewed_by = v_actor,
      reviewed_at = v_now,
      admin_notes = nullif(btrim(p_note), '')
  where id = p_application_id;

  if v_decision = 'accepted'::public.application_status then
    if v_enrolment_status is null then
      insert into public.enrolments (
        student_id,
        class_id,
        application_id,
        status,
        enrolled_at,
        attendance_reviewed_through
      ) values (
        v_student_id,
        v_class_id,
        p_application_id,
        'enrolled',
        v_now,
        null
      );
    elsif not v_changed
          and v_enrolment_status in (
            'enrolled'::public.enrolment_status,
            'suspended'::public.enrolment_status
          ) then
      update public.enrolments
      set application_id = p_application_id
      where student_id = v_student_id
        and class_id = v_class_id;
    else
      update public.enrolments
      set application_id = p_application_id,
          status = 'enrolled',
          enrolled_at = case
            when status in (
              'withdrawn'::public.enrolment_status,
              'completed'::public.enrolment_status,
              'waitlisted'::public.enrolment_status
            ) or v_changed then v_now
            else enrolled_at
          end,
          suspended_at = null,
          suspension_reason = null,
          suspended_by = null,
          reinstated_at = null,
          reinstated_by = null,
          attendance_reviewed_through = null
      where student_id = v_student_id
        and class_id = v_class_id;
    end if;
  else
    update public.enrolments
    set status = 'withdrawn'
    where student_id = v_student_id
      and class_id = v_class_id
      and status in (
        'enrolled'::public.enrolment_status,
        'suspended'::public.enrolment_status,
        'waitlisted'::public.enrolment_status
      );
  end if;

  -- Application transitions end any prior attendance-review episode. Preserve an
  -- active review only when Accepted is being saved without changing lifecycle.
  if v_decision <> 'accepted'::public.application_status
     or v_changed
     or v_enrolment_status is null
     or v_enrolment_status not in (
       'enrolled'::public.enrolment_status,
       'suspended'::public.enrolment_status
     ) then
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
  end if;

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
    'application_' || p_decision,
    jsonb_build_object(
      'status', v_old_status,
      'waitlist_position', v_old_waitlist_position
    ),
    jsonb_build_object(
      'status', v_decision,
      'waitlist_position', v_waitlist_position,
      'reviewed_at', v_now,
      'admin_notes', nullif(btrim(p_note), '')
    )
  );

  if v_changed then
    insert into public.notifications (
      student_id,
      application_id,
      channel,
      template_key,
      status
    ) values (
      v_student_id,
      p_application_id,
      'portal',
      'application_' || p_decision,
      'queued'
    );
  end if;
end;
$$;

revoke execute on function public.admin_decide_application(uuid, text, text)
from public, anon;
grant execute on function public.admin_decide_application(uuid, text, text)
to authenticated;

create or replace function public.admin_suspend_enrolment(
  p_enrolment_id uuid,
  p_reason text,
  p_note text default null,
  p_notify_student boolean default true
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
  v_old_status public.enrolment_status;
  v_now timestamptz := now();
begin
  if v_actor is null
     or coalesce(auth.jwt()->'app_metadata'->>'role', '')
       not in ('admin', 'super_admin') then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  if nullif(btrim(p_reason), '') is null then
    raise exception 'A suspension reason is required';
  end if;

  select e.class_id
  into v_class_id
  from public.enrolments e
  where e.id = p_enrolment_id;

  if v_class_id is null then
    raise exception 'Enrolment not found';
  end if;

  perform 1 from public.classes c where c.id = v_class_id for update;

  select e.student_id, e.status
  into v_student_id, v_old_status
  from public.enrolments e
  where e.id = p_enrolment_id
  for update;

  if v_old_status is distinct from 'enrolled'::public.enrolment_status then
    raise exception 'Only an enrolled student can be suspended';
  end if;

  update public.enrolments
  set status = 'suspended',
      suspended_at = v_now,
      suspension_reason = btrim(p_reason),
      suspended_by = v_actor
  where id = p_enrolment_id;

  update public.suspension_reviews
  set status = 'suspended',
      reviewed_by = v_actor,
      reviewed_at = v_now,
      review_note = nullif(btrim(p_note), '')
  where enrolment_id = p_enrolment_id
    and status = 'open';

  insert into public.audit_log (
    actor_id,
    entity_type,
    entity_id,
    action,
    old_values,
    new_values
  ) values (
    v_actor,
    'enrolment',
    p_enrolment_id::text,
    'student_suspended',
    jsonb_build_object('status', v_old_status),
    jsonb_build_object(
      'status', 'suspended',
      'reason', btrim(p_reason),
      'note', nullif(btrim(p_note), '')
    )
  );

  if p_notify_student then
    insert into public.notifications (
      student_id,
      enrolment_id,
      channel,
      template_key,
      status
    ) values (
      v_student_id,
      p_enrolment_id,
      'portal',
      'enrolment_suspended',
      'queued'
    );
  end if;
end;
$$;

revoke execute on function public.admin_suspend_enrolment(uuid, text, text, boolean)
from public, anon;
grant execute on function public.admin_suspend_enrolment(uuid, text, text, boolean)
to authenticated;

create or replace function public.admin_resolve_attendance_review(
  p_enrolment_id uuid,
  p_resolution text,
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
  v_enrolment_status public.enrolment_status;
  v_review_id uuid;
  v_attendance_id uuid;
  v_latest_absence date;
  v_now timestamptz := now();
begin
  if v_actor is null
     or coalesce(auth.jwt()->'app_metadata'->>'role', '')
       not in ('admin', 'super_admin') then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  if p_resolution not in ('excused', 'kept_enrolled') then
    raise exception 'Unsupported attendance-review resolution';
  end if;

  select e.class_id
  into v_class_id
  from public.enrolments e
  where e.id = p_enrolment_id;

  if v_class_id is null then
    raise exception 'Enrolment not found';
  end if;

  perform 1 from public.classes c where c.id = v_class_id for update;

  select e.student_id, e.status
  into v_student_id, v_enrolment_status
  from public.enrolments e
  where e.id = p_enrolment_id
  for update;

  if v_enrolment_status is distinct from 'enrolled'::public.enrolment_status then
    raise exception 'Only an active enrolment can have its review resolved';
  end if;

  select sr.id
  into v_review_id
  from public.suspension_reviews sr
  where sr.enrolment_id = p_enrolment_id
    and sr.status = 'open'
  order by sr.triggered_at desc
  limit 1
  for update;

  if v_review_id is null then
    raise exception 'No open attendance review was found';
  end if;

  if p_resolution = 'kept_enrolled' then
    v_latest_absence := public.attendance_latest_unexcused_date(p_enrolment_id);
    if v_latest_absence is null then
      raise exception 'No unexcused absence was found for this review';
    end if;

    update public.enrolments
    set attendance_reviewed_through = v_latest_absence
    where id = p_enrolment_id;

    update public.suspension_reviews
    set status = 'kept_enrolled',
        reviewed_by = v_actor,
        reviewed_at = v_now,
        review_note = nullif(btrim(p_note), '')
    where id = v_review_id;
  else
    select a.id, cs.session_date
    into v_attendance_id, v_latest_absence
    from public.attendance a
    join public.class_sessions cs
      on cs.id = a.session_id
     and cs.class_id = v_class_id
    join public.enrolments e on e.id = a.enrolment_id
    where a.enrolment_id = p_enrolment_id
      and a.status = 'absent_unexcused'::public.attendance_status
      and cs.cancelled = false
      and cs.session_date >= greatest(
        (e.enrolled_at at time zone 'Australia/Sydney')::date,
        coalesce(
          (e.reinstated_at at time zone 'Australia/Sydney')::date,
          (e.enrolled_at at time zone 'Australia/Sydney')::date
        )
      )
      and cs.session_date <= (v_now at time zone 'Australia/Sydney')::date
    order by cs.session_date desc, a.updated_at desc, a.id desc
    limit 1
    for update of a;

    if v_attendance_id is null then
      raise exception 'No unexcused absence was found to excuse';
    end if;

    update public.suspension_reviews
    set status = 'excused',
        reviewed_by = v_actor,
        reviewed_at = v_now,
        review_note = nullif(btrim(p_note), '')
    where id = v_review_id;

    update public.attendance
    set status = 'absent_excused',
        note = coalesce(nullif(btrim(p_note), ''), 'Excused by administrator'),
        recorded_by = v_actor,
        updated_at = v_now
    where id = v_attendance_id;
  end if;

  insert into public.audit_log (
    actor_id,
    entity_type,
    entity_id,
    action,
    new_values
  ) values (
    v_actor,
    'enrolment',
    p_enrolment_id::text,
    'attendance_review_' || p_resolution,
    jsonb_build_object(
      'note', nullif(btrim(p_note), ''),
      'attendance_id', v_attendance_id,
      'reviewed_through', v_latest_absence
    )
  );

  insert into public.notifications (
    student_id,
    enrolment_id,
    channel,
    template_key,
    status
  ) values (
    v_student_id,
    p_enrolment_id,
    'portal',
    case p_resolution
      when 'excused' then 'attendance_excused'
      else 'attendance_review_resolved'
    end,
    'queued'
  );
end;
$$;

revoke execute on function public.admin_resolve_attendance_review(uuid, text, text)
from public, anon;
grant execute on function public.admin_resolve_attendance_review(uuid, text, text)
to authenticated;

create or replace function public.admin_reinstate_enrolment(
  p_enrolment_id uuid,
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
  v_old_status public.enrolment_status;
  v_now timestamptz := now();
begin
  if v_actor is null
     or coalesce(auth.jwt()->'app_metadata'->>'role', '')
       not in ('admin', 'super_admin') then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  select e.class_id
  into v_class_id
  from public.enrolments e
  where e.id = p_enrolment_id;

  if v_class_id is null then
    raise exception 'Enrolment not found';
  end if;

  perform 1 from public.classes c where c.id = v_class_id for update;

  select e.student_id, e.status
  into v_student_id, v_old_status
  from public.enrolments e
  where e.id = p_enrolment_id
  for update;

  if v_old_status is distinct from 'suspended'::public.enrolment_status then
    raise exception 'Only a suspended enrolment can be reinstated';
  end if;

  update public.enrolments
  set status = 'enrolled',
      reinstated_at = v_now,
      reinstated_by = v_actor,
      attendance_reviewed_through = null
  where id = p_enrolment_id;

  update public.suspension_reviews
  set status = 'closed',
      reviewed_by = v_actor,
      reviewed_at = v_now,
      review_note = coalesce(nullif(btrim(p_note), ''), review_note)
  where enrolment_id = p_enrolment_id
    and status = 'open';

  insert into public.audit_log (
    actor_id,
    entity_type,
    entity_id,
    action,
    old_values,
    new_values
  ) values (
    v_actor,
    'enrolment',
    p_enrolment_id::text,
    'student_reinstated',
    jsonb_build_object('status', v_old_status),
    jsonb_build_object(
      'status', 'enrolled',
      'note', nullif(btrim(p_note), '')
    )
  );

  insert into public.notifications (
    student_id,
    enrolment_id,
    channel,
    template_key,
    status
  ) values (
    v_student_id,
    p_enrolment_id,
    'portal',
    'enrolment_reinstated',
    'queued'
  );
end;
$$;

revoke execute on function public.admin_reinstate_enrolment(uuid, text)
from public, anon;
grant execute on function public.admin_reinstate_enrolment(uuid, text)
to authenticated;

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

create or replace function public.admin_check_in_by_qr(
  p_class_id uuid,
  p_token uuid
)
returns table (student_name text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_session_id uuid;
  v_session_cancelled boolean;
  v_student_id uuid;
  v_first_name text;
  v_last_name text;
  v_enrolment_id uuid;
  v_enrolment_status public.enrolment_status;
  v_old_attendance_status public.attendance_status;
  v_now timestamptz := now();
begin
  if v_actor is null
     or coalesce(auth.jwt()->'app_metadata'->>'role', '')
       not in ('admin', 'super_admin') then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  select s.session_id, s.session_cancelled
  into v_session_id, v_session_cancelled
  from public.admin_today_session(p_class_id) s;

  if v_session_cancelled then
    raise exception 'Today''s class session is cancelled';
  end if;

  select q.student_id, p.first_name, p.last_name
  into v_student_id, v_first_name, v_last_name
  from public.student_qr_tokens q
  join public.profiles p on p.id = q.student_id
  where q.token = p_token
    and q.active = true
  for share of q;

  if v_student_id is null then
    raise exception 'This QR code is not valid or has been revoked';
  end if;

  select e.id, e.status
  into v_enrolment_id, v_enrolment_status
  from public.enrolments e
  where e.student_id = v_student_id
    and e.class_id = p_class_id
  for update;

  if v_enrolment_id is null then
    raise exception 'This student is not enrolled in the selected class';
  end if;
  if v_enrolment_status = 'suspended'::public.enrolment_status then
    raise exception 'This student is currently suspended from this class';
  end if;
  if v_enrolment_status is distinct from 'enrolled'::public.enrolment_status then
    raise exception 'This enrolment is not active';
  end if;

  select a.status
  into v_old_attendance_status
  from public.attendance a
  where a.enrolment_id = v_enrolment_id
    and a.session_id = v_session_id
  for update;

  insert into public.attendance (
    enrolment_id,
    session_id,
    status,
    checked_in_at,
    checkin_method,
    recorded_by,
    updated_at
  ) values (
    v_enrolment_id,
    v_session_id,
    'present',
    v_now,
    'qr',
    v_actor,
    v_now
  )
  on conflict (enrolment_id, session_id)
  do update set
    status = excluded.status,
    checked_in_at = excluded.checked_in_at,
    checkin_method = excluded.checkin_method,
    recorded_by = excluded.recorded_by,
    updated_at = excluded.updated_at;

  insert into public.audit_log (
    actor_id,
    entity_type,
    entity_id,
    action,
    old_values,
    new_values
  ) values (
    v_actor,
    'attendance',
    v_enrolment_id::text,
    'qr_checkin',
    jsonb_build_object('status', v_old_attendance_status),
    jsonb_build_object(
      'class_id', p_class_id,
      'session_id', v_session_id,
      'student_id', v_student_id,
      'status', 'present',
      'checked_in_at', v_now
    )
  );

  student_name := coalesce(
    nullif(btrim(coalesce(v_first_name, '') || ' ' || coalesce(v_last_name, '')), ''),
    'Student'
  );
  return next;
end;
$$;

revoke execute on function public.admin_check_in_by_qr(uuid, uuid)
from public, anon;
grant execute on function public.admin_check_in_by_qr(uuid, uuid)
to authenticated;

create or replace function public.admin_set_manual_attendance(
  p_enrolment_id uuid,
  p_class_id uuid,
  p_status text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_session_id uuid;
  v_session_cancelled boolean;
  v_enrolment_status public.enrolment_status;
  v_attendance_status public.attendance_status;
  v_old_attendance_status public.attendance_status;
  v_now timestamptz := now();
begin
  if v_actor is null
     or coalesce(auth.jwt()->'app_metadata'->>'role', '')
       not in ('admin', 'super_admin') then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  if p_status not in ('present', 'late', 'absent_unexcused', 'absent_excused') then
    raise exception 'Unsupported attendance status';
  end if;
  v_attendance_status := p_status::public.attendance_status;

  select s.session_id, s.session_cancelled
  into v_session_id, v_session_cancelled
  from public.admin_today_session(p_class_id) s;

  if v_session_cancelled then
    raise exception 'Today''s class session is cancelled';
  end if;

  select e.status
  into v_enrolment_status
  from public.enrolments e
  where e.id = p_enrolment_id
    and e.class_id = p_class_id
  for update;

  if not found then
    raise exception 'The enrolment does not belong to the selected class';
  end if;
  if v_enrolment_status is distinct from 'enrolled'::public.enrolment_status then
    raise exception 'Attendance can only be recorded for an active enrolment';
  end if;

  select a.status
  into v_old_attendance_status
  from public.attendance a
  where a.enrolment_id = p_enrolment_id
    and a.session_id = v_session_id
  for update;

  insert into public.attendance (
    enrolment_id,
    session_id,
    status,
    checked_in_at,
    checkin_method,
    recorded_by,
    updated_at
  ) values (
    p_enrolment_id,
    v_session_id,
    v_attendance_status,
    case
      when v_attendance_status in (
        'present'::public.attendance_status,
        'late'::public.attendance_status
      ) then v_now
      else null
    end,
    'manual',
    v_actor,
    v_now
  )
  on conflict (enrolment_id, session_id)
  do update set
    status = excluded.status,
    checked_in_at = excluded.checked_in_at,
    checkin_method = excluded.checkin_method,
    recorded_by = excluded.recorded_by,
    updated_at = excluded.updated_at;

  insert into public.audit_log (
    actor_id,
    entity_type,
    entity_id,
    action,
    old_values,
    new_values
  ) values (
    v_actor,
    'attendance',
    p_enrolment_id::text,
    'manual_attendance',
    jsonb_build_object('status', v_old_attendance_status),
    jsonb_build_object(
      'class_id', p_class_id,
      'session_id', v_session_id,
      'status', v_attendance_status
    )
  );
end;
$$;

revoke execute on function public.admin_set_manual_attendance(uuid, uuid, text)
from public, anon;
grant execute on function public.admin_set_manual_attendance(uuid, uuid, text)
to authenticated;

create or replace function public.admin_close_today_roll(
  p_class_id uuid
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_session_id uuid;
  v_session_cancelled boolean;
  v_session_starts_at timestamptz;
  v_marked_enrolments uuid[] := '{}'::uuid[];
  v_now timestamptz := now();
begin
  if v_actor is null
     or coalesce(auth.jwt()->'app_metadata'->>'role', '')
       not in ('admin', 'super_admin') then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  select s.session_id, s.session_cancelled, s.session_starts_at
  into v_session_id, v_session_cancelled, v_session_starts_at
  from public.admin_today_session(p_class_id) s;

  if v_session_cancelled then
    raise exception 'This session is cancelled';
  end if;
  if v_session_starts_at is not null and v_session_starts_at > v_now then
    raise exception 'The class session has not started yet';
  end if;

  with inserted as (
    insert into public.attendance (
      enrolment_id,
      session_id,
      status,
      checkin_method,
      recorded_by
    )
    select
      e.id,
      v_session_id,
      'absent_unexcused'::public.attendance_status,
      'roll_close',
      v_actor
    from public.enrolments e
    where e.class_id = p_class_id
      and e.status = 'enrolled'::public.enrolment_status
      and e.enrolled_at <= coalesce(v_session_starts_at, v_now)
      and (
        e.reinstated_at is null
        or e.reinstated_at <= coalesce(v_session_starts_at, v_now)
      )
      and not exists (
        select 1
        from public.attendance a
        where a.enrolment_id = e.id
          and a.session_id = v_session_id
      )
    on conflict (enrolment_id, session_id) do nothing
    returning enrolment_id
  )
  select coalesce(array_agg(i.enrolment_id), '{}'::uuid[])
  into v_marked_enrolments
  from inserted i;

  insert into public.audit_log (
    actor_id,
    entity_type,
    entity_id,
    action,
    new_values
  ) values (
    v_actor,
    'class_session',
    v_session_id::text,
    'attendance_roll_closed',
    jsonb_build_object(
      'class_id', p_class_id,
      'marked_absent', cardinality(v_marked_enrolments),
      'enrolment_ids', to_jsonb(v_marked_enrolments)
    )
  );

  return cardinality(v_marked_enrolments);
end;
$$;

revoke execute on function public.admin_close_today_roll(uuid)
from public, anon;
grant execute on function public.admin_close_today_roll(uuid)
to authenticated;
