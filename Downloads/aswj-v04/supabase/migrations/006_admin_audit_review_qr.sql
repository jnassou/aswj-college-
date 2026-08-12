alter table public.audit_log enable row level security;
grant insert on public.audit_log to authenticated;
create policy audit_log_admin_insert on public.audit_log for insert to authenticated
with check (public.is_admin() and actor_id=(select auth.uid()));

create or replace function public.open_required_suspension_reviews()
returns integer language plpgsql security invoker set search_path=public as $$
declare inserted_count integer;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  insert into public.suspension_reviews(enrolment_id,consecutive_absences)
  select v.enrolment_id,v.consecutive_absences from public.students_requiring_attendance_review v
  where not exists(select 1 from public.suspension_reviews sr where sr.enrolment_id=v.enrolment_id and sr.status='open');
  get diagnostics inserted_count=row_count;
  return inserted_count;
end; $$;
revoke execute on function public.open_required_suspension_reviews() from public,anon;
grant execute on function public.open_required_suspension_reviews() to authenticated,service_role;

create or replace function public.prevent_unauthorized_profile_role_change()
returns trigger language plpgsql security invoker set search_path=public as $$
begin
  if new.role is distinct from old.role and not public.is_admin() then
    raise exception 'Only an administrator may change a profile role';
  end if;
  return new;
end; $$;
revoke execute on function public.prevent_unauthorized_profile_role_change() from public,anon,authenticated;
drop trigger if exists profiles_prevent_role_escalation on public.profiles;
create trigger profiles_prevent_role_escalation before update on public.profiles
for each row execute function public.prevent_unauthorized_profile_role_change();

create unique index if not exists student_qr_one_active_per_student_idx
on public.student_qr_tokens(student_id) where active=true;
create or replace function public.ensure_student_qr_token()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.student_qr_tokens(student_id) values(new.id) on conflict do nothing;
  return new;
end; $$;
revoke execute on function public.ensure_student_qr_token() from public,anon,authenticated;
drop trigger if exists profiles_issue_qr_token on public.profiles;
create trigger profiles_issue_qr_token after insert on public.profiles
for each row execute function public.ensure_student_qr_token();
