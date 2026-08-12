-- ASWJ College v0.4 security hardening and live admin access.
-- Authorization is based on Supabase Auth app_metadata.role, not user-editable user_metadata.

-- Protect all exposed public tables with RLS, including tables missed in the initial baseline.
alter table if exists public.audit_log enable row level security;
alter table if exists public.external_form_submissions enable row level security;

-- The attendance-review view must obey RLS on its underlying tables.
alter view public.students_requiring_attendance_review set (security_invoker = true);

-- The review-generation function is privileged. Do not expose it as a public RPC.
revoke all on function public.create_missing_suspension_reviews() from public;
revoke all on function public.create_missing_suspension_reviews() from anon;
revoke all on function public.create_missing_suspension_reviews() from authenticated;
grant execute on function public.create_missing_suspension_reviews() to service_role;

-- Remove broad default Data API access, then grant only what the app needs.
revoke all on table public.profiles from anon, authenticated;
revoke all on table public.classes from anon, authenticated;
revoke all on table public.applications from anon, authenticated;
revoke all on table public.enrolments from anon, authenticated;
revoke all on table public.class_sessions from anon, authenticated;
revoke all on table public.attendance from anon, authenticated;
revoke all on table public.suspension_reviews from anon, authenticated;
revoke all on table public.notifications from anon, authenticated;
revoke all on table public.audit_log from anon, authenticated;
revoke all on table public.student_qr_tokens from anon, authenticated;
revoke all on table public.external_form_submissions from anon, authenticated;
revoke all on table public.students_requiring_attendance_review from anon, authenticated;

-- Authenticated users need read access to their permitted rows; admins need write access through RLS.
grant select on public.profiles, public.classes, public.applications, public.enrolments,
  public.class_sessions, public.attendance, public.suspension_reviews,
  public.notifications, public.student_qr_tokens, public.students_requiring_attendance_review
  to authenticated;

grant insert, update, delete on public.applications, public.enrolments, public.class_sessions,
  public.attendance, public.suspension_reviews, public.notifications, public.student_qr_tokens
  to authenticated;

grant insert on public.audit_log to authenticated;
grant select on public.audit_log to authenticated;

grant insert, update on public.profiles to authenticated;
grant insert, update, delete on public.classes to authenticated;

-- Helper expressions are repeated inline so no SECURITY DEFINER helper is required.
-- Admin checks read app_metadata, which cannot be edited by normal end users.

-- PROFILES
create policy "profiles_select_own_or_admin"
on public.profiles for select to authenticated
using (
  id = (select auth.uid())
  or coalesce((select auth.jwt()->'app_metadata'->>'role'), '') in ('admin','super_admin')
);

-- A student can edit only their own row. The role column is additionally protected by a trigger below.
create policy "profiles_update_own_or_admin"
on public.profiles for update to authenticated
using (
  id = (select auth.uid())
  or coalesce((select auth.jwt()->'app_metadata'->>'role'), '') in ('admin','super_admin')
)
with check (
  id = (select auth.uid())
  or coalesce((select auth.jwt()->'app_metadata'->>'role'), '') in ('admin','super_admin')
);

create policy "profiles_insert_own_or_admin"
on public.profiles for insert to authenticated
with check (
  id = (select auth.uid())
  or coalesce((select auth.jwt()->'app_metadata'->>'role'), '') in ('admin','super_admin')
);

-- Prevent non-admins changing the legacy profiles.role field.
create or replace function public.prevent_profile_role_escalation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
     and new.role is distinct from old.role
     and coalesce(auth.jwt()->'app_metadata'->>'role', '') not in ('admin','super_admin') then
    raise exception 'Only administrators can change profile roles';
  end if;
  return new;
end;
$$;

revoke all on function public.prevent_profile_role_escalation() from public, anon, authenticated;

drop trigger if exists trg_prevent_profile_role_escalation on public.profiles;
create trigger trg_prevent_profile_role_escalation
before update on public.profiles
for each row execute function public.prevent_profile_role_escalation();

-- CLASSES
create policy "classes_read_authenticated"
on public.classes for select to authenticated using (true);

create policy "classes_admin_insert"
on public.classes for insert to authenticated
with check (coalesce((select auth.jwt()->'app_metadata'->>'role'), '') in ('admin','super_admin'));

create policy "classes_admin_update"
on public.classes for update to authenticated
using (coalesce((select auth.jwt()->'app_metadata'->>'role'), '') in ('admin','super_admin'))
with check (coalesce((select auth.jwt()->'app_metadata'->>'role'), '') in ('admin','super_admin'));

create policy "classes_admin_delete"
on public.classes for delete to authenticated
using (coalesce((select auth.jwt()->'app_metadata'->>'role'), '') in ('admin','super_admin'));

-- APPLICATIONS
create policy "applications_select_own_or_admin"
on public.applications for select to authenticated
using (
  student_id = (select auth.uid())
  or coalesce((select auth.jwt()->'app_metadata'->>'role'), '') in ('admin','super_admin')
);

create policy "applications_insert_own_or_admin"
on public.applications for insert to authenticated
with check (
  student_id = (select auth.uid())
  or coalesce((select auth.jwt()->'app_metadata'->>'role'), '') in ('admin','super_admin')
);

create policy "applications_admin_update"
on public.applications for update to authenticated
using (coalesce((select auth.jwt()->'app_metadata'->>'role'), '') in ('admin','super_admin'))
with check (coalesce((select auth.jwt()->'app_metadata'->>'role'), '') in ('admin','super_admin'));

create policy "applications_admin_delete"
on public.applications for delete to authenticated
using (coalesce((select auth.jwt()->'app_metadata'->>'role'), '') in ('admin','super_admin'));

-- ENROLMENTS
create policy "enrolments_select_own_or_admin"
on public.enrolments for select to authenticated
using (
  student_id = (select auth.uid())
  or coalesce((select auth.jwt()->'app_metadata'->>'role'), '') in ('admin','super_admin')
);

create policy "enrolments_admin_write"
on public.enrolments for all to authenticated
using (coalesce((select auth.jwt()->'app_metadata'->>'role'), '') in ('admin','super_admin'))
with check (coalesce((select auth.jwt()->'app_metadata'->>'role'), '') in ('admin','super_admin'));

-- CLASS SESSIONS
create policy "sessions_read_authenticated"
on public.class_sessions for select to authenticated using (true);

create policy "sessions_admin_write"
on public.class_sessions for all to authenticated
using (coalesce((select auth.jwt()->'app_metadata'->>'role'), '') in ('admin','super_admin'))
with check (coalesce((select auth.jwt()->'app_metadata'->>'role'), '') in ('admin','super_admin'));

-- ATTENDANCE: students can see their own attendance; admins can manage all.
create policy "attendance_select_own_or_admin"
on public.attendance for select to authenticated
using (
  exists (
    select 1 from public.enrolments e
    where e.id = attendance.enrolment_id and e.student_id = (select auth.uid())
  )
  or coalesce((select auth.jwt()->'app_metadata'->>'role'), '') in ('admin','super_admin')
);

create policy "attendance_admin_write"
on public.attendance for all to authenticated
using (coalesce((select auth.jwt()->'app_metadata'->>'role'), '') in ('admin','super_admin'))
with check (coalesce((select auth.jwt()->'app_metadata'->>'role'), '') in ('admin','super_admin'));

-- SUSPENSION REVIEWS
create policy "reviews_admin_select"
on public.suspension_reviews for select to authenticated
using (coalesce((select auth.jwt()->'app_metadata'->>'role'), '') in ('admin','super_admin'));

create policy "reviews_admin_write"
on public.suspension_reviews for all to authenticated
using (coalesce((select auth.jwt()->'app_metadata'->>'role'), '') in ('admin','super_admin'))
with check (coalesce((select auth.jwt()->'app_metadata'->>'role'), '') in ('admin','super_admin'));

-- NOTIFICATIONS
create policy "notifications_select_own_or_admin"
on public.notifications for select to authenticated
using (
  student_id = (select auth.uid())
  or coalesce((select auth.jwt()->'app_metadata'->>'role'), '') in ('admin','super_admin')
);

create policy "notifications_admin_write"
on public.notifications for all to authenticated
using (coalesce((select auth.jwt()->'app_metadata'->>'role'), '') in ('admin','super_admin'))
with check (coalesce((select auth.jwt()->'app_metadata'->>'role'), '') in ('admin','super_admin'));

-- QR TOKENS
create policy "qr_select_own_or_admin"
on public.student_qr_tokens for select to authenticated
using (
  student_id = (select auth.uid())
  or coalesce((select auth.jwt()->'app_metadata'->>'role'), '') in ('admin','super_admin')
);

create policy "qr_admin_write"
on public.student_qr_tokens for all to authenticated
using (coalesce((select auth.jwt()->'app_metadata'->>'role'), '') in ('admin','super_admin'))
with check (coalesce((select auth.jwt()->'app_metadata'->>'role'), '') in ('admin','super_admin'));

-- AUDIT LOG: immutable to normal authenticated users; admins may read and insert only.
create policy "audit_admin_select"
on public.audit_log for select to authenticated
using (coalesce((select auth.jwt()->'app_metadata'->>'role'), '') in ('admin','super_admin'));

create policy "audit_admin_insert"
on public.audit_log for insert to authenticated
with check (
  actor_id = (select auth.uid())
  and coalesce((select auth.jwt()->'app_metadata'->>'role'), '') in ('admin','super_admin')
);

-- No anon/authenticated policies are intentionally created for external_form_submissions.
-- Microsoft Forms ingestion uses a server-only secret + Supabase service role key.
