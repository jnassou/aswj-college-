-- Keep native Registration Setup available through the signed-in admin
-- session. The service-role key remains optional and is used only for legacy
-- Microsoft Forms receipts and reprocessing.

grant select on table public.external_form_course_mappings to authenticated;

-- Replace the blanket client-deny policy with one explicit read policy. RLS
-- continues to deny every write because no write policy or grant is added.
drop policy if exists external_form_course_mappings_no_client_access
on public.external_form_course_mappings;
drop policy if exists external_form_course_mappings_admin_select
on public.external_form_course_mappings;
create policy external_form_course_mappings_admin_select
on public.external_form_course_mappings
for select
to authenticated
using (
  (select auth.uid()) is not null
  and coalesce(
    (select auth.jwt()->'app_metadata'->>'role'),
    ''
  ) in ('admin', 'super_admin')
);

create or replace function private.admin_set_registration_course_mapping_v1(
  p_mapping_id uuid,
  p_class_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null
     or coalesce(auth.jwt()->'app_metadata'->>'role', '')
       not in ('admin', 'super_admin') then
    raise exception 'Administrator access required'
      using errcode = '42501';
  end if;

  -- Reuse the existing transactional validator/audit writer only after the
  -- caller identity and trusted role have been derived inside the database.
  perform public.admin_set_external_course_mapping(
    p_mapping_id,
    p_class_id,
    v_actor
  );
end;
$$;

revoke all on function private.admin_set_registration_course_mapping_v1(uuid, uuid)
from public, anon, authenticated;
grant execute on function private.admin_set_registration_course_mapping_v1(uuid, uuid)
to authenticated;

create or replace function public.admin_set_registration_course_mapping(
  p_mapping_id uuid,
  p_class_id uuid
)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.admin_set_registration_course_mapping_v1(
    p_mapping_id,
    p_class_id
  );
$$;

revoke all on function public.admin_set_registration_course_mapping(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.admin_set_registration_course_mapping(uuid, uuid)
to authenticated;
