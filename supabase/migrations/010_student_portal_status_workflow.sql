-- Link application notifications to their source record so the portal can show class context.
alter table public.notifications
  add column if not exists application_id uuid
  references public.applications(id) on delete set null;

create index if not exists notifications_application_idx
on public.notifications(application_id);

-- Consecutive absences start when the student joins the class and use only recorded
-- roll outcomes. An open/missing roll is not an absence.
create or replace function public.attendance_consecutive_absences(p_enrolment_id uuid)
returns bigint
language sql
stable
security invoker
set search_path = public
as $$
  with settings as (
    select (now() at time zone 'Australia/Sydney')::date as today
  ), enrolment_class as (
    select class_id, (enrolled_at at time zone 'Australia/Sydney')::date as enrolled_on
    from public.enrolments
    where id = p_enrolment_id
  ), ordered as (
    select
      a.status,
      row_number() over (order by cs.session_date desc) as rn
    from public.class_sessions cs
    join enrolment_class ec on ec.class_id = cs.class_id
    cross join settings s
    join public.attendance a
      on a.session_id = cs.id
     and a.enrolment_id = p_enrolment_id
    where cs.cancelled = false
      and cs.session_date >= ec.enrolled_on
      and cs.session_date <= s.today
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

revoke execute on function public.attendance_consecutive_absences(uuid) from public, anon;
grant execute on function public.attendance_consecutive_absences(uuid) to authenticated, service_role;

-- Use the existing, valid "closed" review status when a corrected attendance record
-- clears the streak. Migration 008 used "cleared", which the table constraint rejects.
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
begin
  if tg_op = 'DELETE' then
    v_enrolment_id := old.enrolment_id;
  else
    v_enrolment_id := new.enrolment_id;
  end if;

  select e.status, c.absence_threshold
  into v_status, v_threshold
  from public.enrolments e
  join public.classes c on c.id = e.class_id
  where e.id = v_enrolment_id;

  if v_status is distinct from 'enrolled'::public.enrolment_status then
    return null;
  end if;

  v_streak := public.attendance_consecutive_absences(v_enrolment_id);

  if v_streak >= v_threshold then
    insert into public.suspension_reviews (enrolment_id, consecutive_absences, status)
    values (v_enrolment_id, v_streak::integer, 'open')
    on conflict (enrolment_id) where status = 'open'
    do update set consecutive_absences = excluded.consecutive_absences;
  else
    update public.suspension_reviews
    set status = 'closed',
        reviewed_at = now(),
        review_note = coalesce(review_note, 'Attendance streak cleared automatically')
    where enrolment_id = v_enrolment_id
      and status = 'open';
  end if;

  return null;
end;
$$;

revoke execute on function public.refresh_attendance_suspension_review()
from public, anon, authenticated;

-- Students may acknowledge only their own portal notifications. The function is
-- deliberately narrow: callers cannot change recipients, templates or delivery state.
create or replace function public.mark_portal_notifications_read(
  p_notification_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_updated integer;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  update public.notifications
  set read_at = coalesce(read_at, now())
  where student_id = v_user_id
    and channel = 'portal'
    and read_at is null
    and (p_notification_id is null or id = p_notification_id);

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

revoke execute on function public.mark_portal_notifications_read(uuid)
from public, anon;
grant execute on function public.mark_portal_notifications_read(uuid)
to authenticated;
