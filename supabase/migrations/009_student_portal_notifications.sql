-- Reconciles the student notification workflow already deployed to the live project.
alter table public.notifications
  add column if not exists read_at timestamptz;

create index if not exists notifications_student_created_idx
on public.notifications(student_id, created_at desc);

create or replace function public.queue_attendance_portal_notice()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student_id uuid;
  v_streak bigint;
  v_threshold integer;
  v_template text;
begin
  select e.student_id, c.absence_threshold
  into v_student_id, v_threshold
  from public.enrolments e
  join public.classes c on c.id = e.class_id
  where e.id = new.enrolment_id;

  if v_student_id is null then
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

  if not exists (
    select 1
    from public.notifications n
    where n.student_id = v_student_id
      and n.enrolment_id = new.enrolment_id
      and n.template_key = v_template
      and n.created_at > now() - interval '14 days'
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
