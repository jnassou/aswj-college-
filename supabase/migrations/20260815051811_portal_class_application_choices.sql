-- Native Student Portal applications use real class rows directly. The
-- Microsoft Forms mapping table remains solely for legacy import processing.

create or replace function private.student_registration_class_options_v1()
returns table (
  class_id uuid,
  class_name text,
  term text,
  location text,
  day_of_week smallint,
  start_time time,
  end_time time,
  available boolean,
  availability_reason text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null
     or coalesce(auth.jwt()->'app_metadata'->>'role', 'student') <> 'student'
     or not exists (
       select 1
       from public.profiles p
       join auth.users u on u.id = p.id
       where p.id = v_actor
         and p.role = 'student'::public.user_role
         and nullif(btrim(u.email), '') is not null
         and u.email_confirmed_at is not null
     ) then
    raise exception 'Confirmed student access required'
      using errcode = '42501';
  end if;

  return query
  select
    c.id,
    c.name,
    c.term,
    c.location,
    c.day_of_week,
    c.start_time,
    c.end_time,
    case
      when c.registration_opens_at is not null and now() < c.registration_opens_at then false
      when c.registration_closes_at is not null and now() > c.registration_closes_at then false
      else true
    end,
    case
      when c.registration_opens_at is not null and now() < c.registration_opens_at
        then 'registration_not_open'
      when c.registration_closes_at is not null and now() > c.registration_closes_at
        then 'registration_closed'
      else null
    end
  from public.classes c
  where c.active = true
    and c.registration_enabled = true
  order by lower(btrim(c.name)), c.term nulls last, c.id;
end;
$$;

revoke all on function private.student_registration_class_options_v1()
from public, anon, authenticated, service_role;
grant execute on function private.student_registration_class_options_v1()
to authenticated;

create or replace function public.student_registration_class_options()
returns table (
  class_id uuid,
  class_name text,
  term text,
  location text,
  day_of_week smallint,
  start_time time,
  end_time time,
  available boolean,
  availability_reason text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.student_registration_class_options_v1();
$$;

revoke all on function public.student_registration_class_options()
from public, anon, authenticated, service_role;
grant execute on function public.student_registration_class_options()
to authenticated;

create or replace function private.student_submit_class_application_v1(
  p_class_id uuid,
  p_first_name text,
  p_last_name text,
  p_date_of_birth date,
  p_phone_number text,
  p_guardian_full_name text default null,
  p_guardian_phone_number text default null,
  p_medical_learning_allergy_notes text default null,
  p_previous_studies text default null,
  p_whatsapp_opt_in boolean default false,
  p_privacy_notice_version text default null
)
returns table (
  result text,
  application_id uuid,
  application_status text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_auth_email text;
  v_first_name text := btrim(coalesce(p_first_name, ''));
  v_last_name text := btrim(coalesce(p_last_name, ''));
  v_phone_number text := btrim(coalesce(p_phone_number, ''));
  v_guardian_name text := nullif(btrim(coalesce(p_guardian_full_name, '')), '');
  v_guardian_phone text := nullif(btrim(coalesce(p_guardian_phone_number, '')), '');
  v_wellbeing text := nullif(btrim(coalesce(p_medical_learning_allergy_notes, '')), '');
  v_previous_studies text := nullif(btrim(coalesce(p_previous_studies, '')), '');
  v_class_active boolean;
  v_registration_enabled boolean;
  v_registration_opens_at timestamptz;
  v_registration_closes_at timestamptz;
  v_application_id uuid;
  v_application_status public.application_status;
begin
  if v_actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if coalesce(auth.jwt()->'app_metadata'->>'role', 'student') <> 'student' then
    raise exception 'Student access required' using errcode = '42501';
  end if;

  select u.email
  into v_auth_email
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.id = v_actor
    and p.role = 'student'::public.user_role
    and nullif(btrim(u.email), '') is not null
    and u.email_confirmed_at is not null;

  if not found then
    raise exception 'Confirmed student access required'
      using errcode = '42501';
  end if;

  if p_class_id is null then
    raise exception 'Class is required';
  end if;

  if char_length(v_first_name) not between 1 and 100
     or v_first_name ~ '[[:cntrl:]]' then
    raise exception 'Invalid first name';
  end if;

  if char_length(v_last_name) not between 1 and 100
     or v_last_name ~ '[[:cntrl:]]' then
    raise exception 'Invalid last name';
  end if;

  if p_date_of_birth is null
     or p_date_of_birth < date '1900-01-01'
     or p_date_of_birth >= current_date then
    raise exception 'Invalid date of birth';
  end if;

  if char_length(v_phone_number) not between 1 and 50
     or v_phone_number !~ '^[-0-9+(). ]+$'
     or char_length(regexp_replace(v_phone_number, '[^0-9]', '', 'g')) not between 8 and 15
     or char_length(v_phone_number) - char_length(replace(v_phone_number, '+', '')) > 1
     or position('+' in v_phone_number) > 1 then
    raise exception 'Invalid phone number';
  end if;

  if (v_guardian_name is null) <> (v_guardian_phone is null) then
    raise exception 'Guardian name and phone must be supplied together';
  end if;

  if v_guardian_name is not null
     and (char_length(v_guardian_name) > 100 or v_guardian_name ~ '[[:cntrl:]]') then
    raise exception 'Invalid guardian name';
  end if;

  if v_guardian_phone is not null
     and (
       char_length(v_guardian_phone) > 50
       or v_guardian_phone !~ '^[-0-9+(). ]+$'
       or char_length(regexp_replace(v_guardian_phone, '[^0-9]', '', 'g')) not between 8 and 15
       or char_length(v_guardian_phone) - char_length(replace(v_guardian_phone, '+', '')) > 1
       or position('+' in v_guardian_phone) > 1
     ) then
    raise exception 'Invalid guardian phone number';
  end if;

  if v_wellbeing is not null and char_length(v_wellbeing) > 2000 then
    raise exception 'Wellbeing notes are too long';
  end if;

  if v_previous_studies is not null and char_length(v_previous_studies) > 2000 then
    raise exception 'Previous studies are too long';
  end if;

  if p_privacy_notice_version is distinct from '2026-08-14' then
    raise exception 'Privacy consent is required';
  end if;

  -- The class row is the authoritative choice. Lock it before checking the
  -- application so class setting changes and submissions have one clear order.
  select
    c.active,
    c.registration_enabled,
    c.registration_opens_at,
    c.registration_closes_at
  into
    v_class_active,
    v_registration_enabled,
    v_registration_opens_at,
    v_registration_closes_at
  from public.classes c
  where c.id = p_class_id
  for update;

  if not found or not v_class_active then
    raise exception 'Class is not active';
  end if;

  if not v_registration_enabled then
    raise exception 'Class registration is not enabled';
  end if;

  if v_registration_opens_at is not null and now() < v_registration_opens_at then
    raise exception 'Class registration has not opened';
  end if;

  if v_registration_closes_at is not null and now() > v_registration_closes_at then
    raise exception 'Class registration has closed';
  end if;

  select a.id, a.status
  into v_application_id, v_application_status
  from public.applications a
  where a.student_id = v_actor
    and a.class_id = p_class_id
  for update;

  if found then
    return query
    select 'already_exists'::text, v_application_id, v_application_status::text;
    return;
  end if;

  insert into public.applications (
    student_id,
    class_id,
    status,
    source,
    submitted_at
  ) values (
    v_actor,
    p_class_id,
    'pending'::public.application_status,
    'student_portal',
    now()
  )
  on conflict (student_id, class_id) do nothing
  returning id, status
  into v_application_id, v_application_status;

  if v_application_id is null then
    select a.id, a.status
    into v_application_id, v_application_status
    from public.applications a
    where a.student_id = v_actor
      and a.class_id = p_class_id;

    return query
    select 'already_exists'::text, v_application_id, v_application_status::text;
    return;
  end if;

  update public.profiles
  set first_name = v_first_name,
      last_name = v_last_name,
      mobile = v_phone_number,
      date_of_birth = p_date_of_birth,
      updated_at = now()
  where id = v_actor;

  insert into public.application_registration_details (
    application_id,
    student_first_name,
    student_last_name,
    date_of_birth,
    email_address,
    phone_number,
    guardian_full_name,
    guardian_phone_number,
    medical_learning_allergy_notes,
    previous_studies,
    whatsapp_opt_in,
    privacy_notice_version,
    consented_at
  ) values (
    v_application_id,
    v_first_name,
    v_last_name,
    p_date_of_birth,
    lower(btrim(v_auth_email)),
    v_phone_number,
    v_guardian_name,
    v_guardian_phone,
    v_wellbeing,
    v_previous_studies,
    coalesce(p_whatsapp_opt_in, false),
    p_privacy_notice_version,
    now()
  );

  insert into public.audit_log (
    actor_id,
    entity_type,
    entity_id,
    action,
    new_values
  ) values (
    v_actor,
    'application',
    v_application_id::text,
    'student_application_submitted',
    jsonb_build_object(
      'student_id', v_actor,
      'class_id', p_class_id,
      'application_id', v_application_id,
      'status', v_application_status,
      'source', 'student_portal'
    )
  );

  return query
  select 'created'::text, v_application_id, v_application_status::text;
end;
$$;

revoke all on function private.student_submit_class_application_v1(
  uuid, text, text, date, text, text, text, text, text, boolean, text
)
from public, anon, authenticated, service_role;
grant execute on function private.student_submit_class_application_v1(
  uuid, text, text, date, text, text, text, text, text, boolean, text
)
to authenticated;

create or replace function public.student_submit_class_application(
  p_class_id uuid,
  p_first_name text,
  p_last_name text,
  p_date_of_birth date,
  p_phone_number text,
  p_guardian_full_name text default null,
  p_guardian_phone_number text default null,
  p_medical_learning_allergy_notes text default null,
  p_previous_studies text default null,
  p_whatsapp_opt_in boolean default false,
  p_privacy_notice_version text default null
)
returns table (
  result text,
  application_id uuid,
  application_status text
)
language sql
security invoker
set search_path = ''
as $$
  select *
  from private.student_submit_class_application_v1(
    p_class_id,
    p_first_name,
    p_last_name,
    p_date_of_birth,
    p_phone_number,
    p_guardian_full_name,
    p_guardian_phone_number,
    p_medical_learning_allergy_notes,
    p_previous_studies,
    p_whatsapp_opt_in,
    p_privacy_notice_version
  );
$$;

revoke all on function public.student_submit_class_application(
  uuid, text, text, date, text, text, text, text, text, boolean, text
)
from public, anon, authenticated, service_role;
grant execute on function public.student_submit_class_application(
  uuid, text, text, date, text, text, text, text, text, boolean, text
)
to authenticated;

comment on function public.student_registration_class_options() is
  'Returns real classes explicitly enabled for authenticated Student Portal applications.';
comment on function public.student_submit_class_application(
  uuid, text, text, date, text, text, text, text, text, boolean, text
) is
  'Submits one authenticated student application against an eligible class ID.';
