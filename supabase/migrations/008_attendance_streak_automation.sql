create unique index if not exists suspension_reviews_one_open_per_enrolment_idx
on public.suspension_reviews(enrolment_id) where status='open';

create or replace function public.attendance_consecutive_absences(p_enrolment_id uuid)
returns bigint language sql stable security invoker set search_path=public as $$
  with enrolment_class as (
    select class_id from public.enrolments where id=p_enrolment_id
  ), ordered as (
    select case when a.status is null and cs.session_date < current_date then 'absent_unexcused'::public.attendance_status else a.status end as status,
           row_number() over(order by cs.session_date desc) as rn
    from public.class_sessions cs
    join enrolment_class ec on ec.class_id=cs.class_id
    left join public.attendance a on a.session_id=cs.id and a.enrolment_id=p_enrolment_id
    where cs.cancelled=false and cs.session_date <= current_date
  ), first_break as (
    select min(rn) filter(where status is distinct from 'absent_unexcused'::public.attendance_status) as break_rn from ordered
  )
  select count(*) from ordered,first_break
  where status='absent_unexcused'::public.attendance_status
    and rn < coalesce(break_rn,2147483647::bigint);
$$;
revoke execute on function public.attendance_consecutive_absences(uuid) from public,anon;
grant execute on function public.attendance_consecutive_absences(uuid) to authenticated,service_role;

create or replace function public.refresh_attendance_suspension_review()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_enrolment_id uuid; v_streak bigint; v_threshold integer; v_status public.enrolment_status;
begin
  if tg_op='DELETE' then v_enrolment_id:=old.enrolment_id; else v_enrolment_id:=new.enrolment_id; end if;
  select e.status,c.absence_threshold into v_status,v_threshold
  from public.enrolments e join public.classes c on c.id=e.class_id where e.id=v_enrolment_id;
  if v_status is distinct from 'enrolled'::public.enrolment_status then return null; end if;
  v_streak:=public.attendance_consecutive_absences(v_enrolment_id);
  if v_streak>=v_threshold then
    insert into public.suspension_reviews(enrolment_id,consecutive_absences,status)
    values(v_enrolment_id,v_streak::integer,'open')
    on conflict (enrolment_id) where status='open'
    do update set consecutive_absences=excluded.consecutive_absences;
  else
    update public.suspension_reviews set status='cleared',reviewed_at=now(),
      review_note=coalesce(review_note,'Attendance streak cleared automatically')
    where enrolment_id=v_enrolment_id and status='open';
  end if;
  return null;
end; $$;
revoke execute on function public.refresh_attendance_suspension_review() from public,anon,authenticated;
drop trigger if exists attendance_refresh_suspension_review on public.attendance;
create trigger attendance_refresh_suspension_review after insert or update or delete on public.attendance
for each row execute function public.refresh_attendance_suspension_review();

create or replace view public.student_attendance_streaks with (security_invoker=true) as
select e.id enrolment_id,e.student_id,e.class_id,
 public.attendance_consecutive_absences(e.id) consecutive_absences,c.absence_threshold,
 case when public.attendance_consecutive_absences(e.id)>=c.absence_threshold then 'review_required'
      when public.attendance_consecutive_absences(e.id)=greatest(c.absence_threshold-1,1) then 'warning'
      else 'ok' end review_state
from public.enrolments e join public.classes c on c.id=e.class_id
where e.status='enrolled'::public.enrolment_status;
grant select on public.student_attendance_streaks to authenticated,service_role;

create or replace view public.students_requiring_attendance_review with (security_invoker=true) as
select enrolment_id,student_id,class_id,consecutive_absences,absence_threshold
from public.student_attendance_streaks where consecutive_absences>=absence_threshold;
grant select on public.students_requiring_attendance_review to authenticated,service_role;
