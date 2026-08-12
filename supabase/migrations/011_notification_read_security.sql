-- Let the read-marker RPC run with the student's own RLS permissions rather than
-- elevated table-owner permissions. A trigger prevents direct Data API callers from
-- changing any notification content or delivery fields.
create or replace function public.protect_student_notification_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if coalesce(auth.jwt()->'app_metadata'->>'role', '') not in ('admin', 'super_admin') then
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

drop trigger if exists notifications_protect_student_update on public.notifications;
create trigger notifications_protect_student_update
before update on public.notifications
for each row execute function public.protect_student_notification_update();

drop policy if exists "notifications_student_mark_read" on public.notifications;
create policy "notifications_student_mark_read"
on public.notifications for update to authenticated
using (
  student_id = (select auth.uid())
  and channel = 'portal'
)
with check (
  student_id = (select auth.uid())
  and channel = 'portal'
);

create or replace function public.mark_portal_notifications_read(
  p_notification_id uuid default null
)
returns integer
language plpgsql
security invoker
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
  set read_at = now()
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
