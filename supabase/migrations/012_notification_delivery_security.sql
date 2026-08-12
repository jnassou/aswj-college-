-- Preserve trusted delivery workers and database maintenance while keeping direct
-- student updates limited to the read timestamp.
create or replace function public.protect_student_notification_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user not in ('postgres', 'service_role', 'supabase_admin')
     and coalesce(auth.jwt()->>'role', '') <> 'service_role'
     and coalesce(auth.jwt()->'app_metadata'->>'role', '') not in ('admin', 'super_admin') then
    if (to_jsonb(new) - 'read_at') is distinct from (to_jsonb(old) - 'read_at') then
      raise exception 'Students may only mark notifications as read';
    end if;

    if old.read_at is not null then
      new.read_at := old.read_at;
    elsif new.read_at is null then
      raise exception 'A read timestamp is required';
    else
      new.read_at := now();
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.protect_student_notification_update()
from public, anon, authenticated;
