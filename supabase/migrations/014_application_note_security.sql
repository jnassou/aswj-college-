-- Internal review notes must not be readable by a student through the Data API.
-- RLS limits rows, so column privileges remove the internal field for every normal
-- authenticated query and a narrowly checked RPC restores access for administrators.
revoke all privileges on table public.applications from anon;
revoke select on table public.applications from authenticated;
revoke insert on table public.applications from authenticated;
revoke delete, truncate, references, trigger
on table public.applications from authenticated;

grant select (
  id,
  student_id,
  class_id,
  status,
  waitlist_position,
  source,
  external_response_id,
  submitted_at,
  reviewed_by,
  reviewed_at
) on table public.applications to authenticated;

-- Student submissions may rely on database defaults, but may not choose a decision,
-- waitlist position, reviewer, review note or source identity.
grant insert (student_id, class_id)
on table public.applications to authenticated;

create or replace function public.get_application_admin_notes(
  p_application_ids uuid[]
)
returns table (
  application_id uuid,
  admin_notes text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null
     or coalesce(auth.jwt()->'app_metadata'->>'role', '')
        not in ('admin', 'super_admin') then
    raise exception 'Administrator access required'
      using errcode = '42501';
  end if;

  return query
  select a.id, a.admin_notes
  from public.applications a
  where a.id = any(coalesce(p_application_ids, '{}'::uuid[]));
end;
$$;

revoke all on function public.get_application_admin_notes(uuid[])
from public, anon, authenticated;
grant execute on function public.get_application_admin_notes(uuid[])
to authenticated;

-- RLS does not govern TRUNCATE. Remove broad maintenance privileges from Data API
-- roles while preserving the explicit row operations used by the application.
revoke all privileges on table public.notifications from anon;
revoke delete, truncate, references, trigger on table public.notifications
from authenticated;
