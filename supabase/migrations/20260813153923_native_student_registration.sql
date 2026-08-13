-- Replace the public Microsoft Form with an authenticated Student Portal
-- application flow. Existing external receipts remain available as a legacy
-- fallback, but both paths now share the same exact course mapping and class
-- availability rules.

alter table public.classes
add column registration_enabled boolean not null default false;

comment on column public.classes.registration_enabled is
  'Explicit administrator switch for Student Portal and legacy form applications.';

create table public.application_registration_details (
  application_id uuid primary key
    references public.applications(id) on delete cascade,
  student_first_name text not null,
  student_last_name text not null,
  date_of_birth date not null,
  email_address text not null,
  phone_number text not null,
  guardian_full_name text,
  guardian_phone_number text,
  medical_learning_allergy_notes text,
  previous_studies text,
  whatsapp_opt_in boolean not null default false,
  privacy_notice_version text not null,
  consented_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint application_registration_details_first_name_check
    check (char_length(btrim(student_first_name)) between 1 and 100),
  constraint application_registration_details_last_name_check
    check (char_length(btrim(student_last_name)) between 1 and 100),
  constraint application_registration_details_date_of_birth_check
    check (date_of_birth >= date '1900-01-01'),
  constraint application_registration_details_email_check
    check (char_length(btrim(email_address)) between 3 and 320),
  constraint application_registration_details_phone_check
    check (char_length(btrim(phone_number)) between 1 and 50),
  constraint application_registration_details_guardian_name_check
    check (guardian_full_name is null or char_length(btrim(guardian_full_name)) between 1 and 100),
  constraint application_registration_details_guardian_phone_check
    check (guardian_phone_number is null or char_length(btrim(guardian_phone_number)) between 1 and 50),
  constraint application_registration_details_guardian_pair_check
    check ((guardian_full_name is null) = (guardian_phone_number is null)),
  constraint application_registration_details_wellbeing_check
    check (medical_learning_allergy_notes is null or char_length(medical_learning_allergy_notes) <= 2000),
  constraint application_registration_details_studies_check
    check (previous_studies is null or char_length(previous_studies) <= 2000),
  constraint application_registration_details_privacy_version_check
    check (privacy_notice_version = '2026-08-14')
);

comment on table public.application_registration_details is
  'Private, one-to-one snapshot of the answers supplied with a native application.';

alter table public.application_registration_details enable row level security;
revoke all on table public.application_registration_details
from public, anon, authenticated, service_role;
grant select on table public.application_registration_details to service_role;

create policy application_registration_details_no_client_access
on public.application_registration_details
as restrictive
for all
to anon, authenticated
using (false)
with check (false);

-- Direct Data API inserts could bypass the exact mapping and open/close checks.
-- The authenticated RPC below is now the only student submission path.
revoke insert on table public.applications from authenticated;
revoke insert (student_id, class_id)
on table public.applications from authenticated;
drop policy if exists applications_insert_own_or_admin
on public.applications;

-- Profile emails are Auth-owned identity data. Students and administrators may
-- continue editing the demographic fields used by the existing UI, but the
-- email cannot be changed through the public profiles endpoint.
revoke insert, update on table public.profiles from authenticated;
grant update (
  first_name,
  last_name,
  mobile,
  date_of_birth,
  emergency_contact_name,
  emergency_contact_mobile,
  updated_at
) on table public.profiles to authenticated;
drop policy if exists profiles_insert_own_or_admin
on public.profiles;

create or replace function private.student_registration_options_v1()
returns table (
  course_name text,
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
  with supported_courses(course_name, display_order) as (
    values
      ('Brothers Shariah Level 1 Wednesday Evening'::text, 1),
      ('Brothers Shariah Level 3 Wednesday Evening'::text, 2),
      ('Sisters Shariah Level 1 Thursday Morning'::text, 3),
      ('Sisters Shariah Level 2 Thursday Morning'::text, 4),
      ('Sisters Shariah Level 3 Wednesday Evening'::text, 5)
  )
  select
    supported.course_name,
    c.name,
    c.term,
    c.location,
    c.day_of_week,
    c.start_time,
    c.end_time,
    case
      when m.id is null or not m.active then false
      when m.class_id is null or c.id is null then false
      when not c.active or not c.registration_enabled then false
      when c.registration_opens_at is not null and now() < c.registration_opens_at then false
      when c.registration_closes_at is not null and now() > c.registration_closes_at then false
      else true
    end,
    case
      when m.id is null or not m.active then 'course_unconfigured'
      when m.class_id is null then 'course_unconfigured'
      when c.id is null then 'class_not_found'
      when not c.active then 'class_inactive'
      when not c.registration_enabled then 'registration_disabled'
      when c.registration_opens_at is not null and now() < c.registration_opens_at
        then 'registration_not_open'
      when c.registration_closes_at is not null and now() > c.registration_closes_at
        then 'registration_closed'
      else null
    end
  from supported_courses supported
  left join public.external_form_course_mappings m
    on m.provider = 'microsoft_forms'
   and m.external_course_name = supported.course_name
  left join public.classes c on c.id = m.class_id
  order by supported.display_order;
end;
$$;

revoke all on function private.student_registration_options_v1()
from public, anon, authenticated;
grant execute on function private.student_registration_options_v1()
to authenticated;

create or replace function public.student_registration_options()
returns table (
  course_name text,
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
  select * from private.student_registration_options_v1();
$$;

revoke all on function public.student_registration_options()
from public, anon, authenticated;
grant execute on function public.student_registration_options()
to authenticated;

create or replace function private.student_submit_registration_v1(
  p_course_name text,
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
  v_class_id uuid;
  v_confirmed_class_id uuid;
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

  if p_course_name is null or p_course_name <> all(array[
    'Brothers Shariah Level 1 Wednesday Evening',
    'Brothers Shariah Level 3 Wednesday Evening',
    'Sisters Shariah Level 1 Thursday Morning',
    'Sisters Shariah Level 2 Thursday Morning',
    'Sisters Shariah Level 3 Wednesday Evening'
  ]::text[]) then
    raise exception 'Unsupported course';
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
     or (position('+' in v_phone_number) > 1) then
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

  select m.class_id
  into v_class_id
  from public.external_form_course_mappings m
  where m.provider = 'microsoft_forms'
    and m.external_course_name = p_course_name
    and m.active = true;

  if not found or v_class_id is null then
    raise exception 'Course registration is not configured';
  end if;

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
  where c.id = v_class_id
  for update;

  if not found or not v_class_active then
    raise exception 'Class is not active';
  end if;

  -- Lock in class -> mapping order. Class deletion also takes these locks in
  -- that order through the mapping foreign key, avoiding a reverse-order
  -- deadlock. Re-reading the mapping prevents a concurrent remap from sending
  -- this application to a class other than the one just validated.
  select m.class_id
  into v_confirmed_class_id
  from public.external_form_course_mappings m
  where m.provider = 'microsoft_forms'
    and m.external_course_name = p_course_name
    and m.active = true
  for update;

  if not found
     or v_confirmed_class_id is null
     or v_confirmed_class_id is distinct from v_class_id then
    raise exception 'Course mapping changed; reload and try again';
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
    and a.class_id = v_class_id
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
    v_class_id,
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
      and a.class_id = v_class_id;

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
      'class_id', v_class_id,
      'application_id', v_application_id,
      'status', v_application_status,
      'source', 'student_portal'
    )
  );

  return query
  select 'created'::text, v_application_id, v_application_status::text;
end;
$$;

revoke all on function private.student_submit_registration_v1(
  text, text, text, date, text, text, text, text, text, boolean, text
)
from public, anon, authenticated;
grant execute on function private.student_submit_registration_v1(
  text, text, text, date, text, text, text, text, text, boolean, text
)
to authenticated;

create or replace function public.student_submit_registration(
  p_course_name text,
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
  from private.student_submit_registration_v1(
    p_course_name,
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

revoke all on function public.student_submit_registration(
  text, text, text, date, text, text, text, text, text, boolean, text
)
from public, anon, authenticated;
grant execute on function public.student_submit_registration(
  text, text, text, date, text, text, text, text, text, boolean, text
)
to authenticated;

create or replace function private.admin_get_application_registration_details_v1(
  p_application_id uuid
)
returns table (
  application_id uuid,
  student_first_name text,
  student_last_name text,
  date_of_birth date,
  email_address text,
  phone_number text,
  guardian_full_name text,
  guardian_phone_number text,
  medical_learning_allergy_notes text,
  previous_studies text,
  whatsapp_opt_in boolean,
  privacy_notice_version text,
  consented_at timestamptz
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
  select
    d.application_id,
    d.student_first_name,
    d.student_last_name,
    d.date_of_birth,
    d.email_address,
    d.phone_number,
    d.guardian_full_name,
    d.guardian_phone_number,
    d.medical_learning_allergy_notes,
    d.previous_studies,
    d.whatsapp_opt_in,
    d.privacy_notice_version,
    d.consented_at
  from public.application_registration_details d
  where d.application_id = p_application_id;
end;
$$;

revoke all on function private.admin_get_application_registration_details_v1(uuid)
from public, anon, authenticated;
grant execute on function private.admin_get_application_registration_details_v1(uuid)
to authenticated;

create or replace function public.get_application_registration_details(
  p_application_id uuid
)
returns table (
  application_id uuid,
  student_first_name text,
  student_last_name text,
  date_of_birth date,
  email_address text,
  phone_number text,
  guardian_full_name text,
  guardian_phone_number text,
  medical_learning_allergy_notes text,
  previous_studies text,
  whatsapp_opt_in boolean,
  privacy_notice_version text,
  consented_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select *
  from private.admin_get_application_registration_details_v1(p_application_id);
$$;

revoke all on function public.get_application_registration_details(uuid)
from public, anon, authenticated;
grant execute on function public.get_application_registration_details(uuid)
to authenticated;

-- Make the legacy Microsoft Forms processor respect the same explicit class
-- availability switch and registration window as the native form.
create or replace function public.process_external_form_submission(
  p_submission_id uuid,
  p_actor_id uuid default null
)
returns table (
  submission_id uuid,
  result_status text,
  result_code text,
  result_application_id uuid
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_submission public.external_form_submissions%rowtype;
  v_student_ids uuid[];
  v_student_id uuid;
  v_class_id uuid;
  v_class_active boolean;
  v_registration_enabled boolean;
  v_registration_opens_at timestamptz;
  v_registration_closes_at timestamptz;
  v_application_id uuid;
  v_status text := 'needs_review';
  v_code text;
  v_note text;
  v_mapping_found boolean := false;
  v_attempt integer;
begin
  select s.*
  into v_submission
  from public.external_form_submissions s
  where s.id = p_submission_id
  for update;

  if not found then
    raise exception 'External form submission not found' using errcode = 'P0002';
  end if;

  if v_submission.processing_status = 'processed'
     and v_submission.application_id is not null then
    return query
    select
      v_submission.id,
      v_submission.processing_status,
      v_submission.processing_code,
      v_submission.application_id;
    return;
  end if;

  v_attempt := v_submission.attempt_count + 1;

  if jsonb_array_length(v_submission.validation_errors) > 0 then
    v_code := 'invalid_fields';
    v_note := 'One or more submitted fields could not be validated.';
  elsif nullif(btrim(v_submission.normalized_email), '') is null then
    v_code := 'missing_email';
    v_note := 'No student email address was supplied.';
  else
    select array_agg(p.id order by p.id)
    into v_student_ids
    from public.profiles p
    where p.role = 'student'::public.user_role
      and lower(btrim(p.email)) = lower(btrim(v_submission.normalized_email));

    if coalesce(cardinality(v_student_ids), 0) = 0 then
      v_code := 'student_not_found';
      v_note := 'No existing Student Portal profile matches this email address.';
    elsif cardinality(v_student_ids) > 1 then
      v_code := 'student_email_ambiguous';
      v_note := 'More than one Student Portal profile matches this email address.';
    else
      v_student_id := v_student_ids[1];

      if nullif(btrim(v_submission.selected_course), '') is null then
        v_code := 'missing_course';
        v_note := 'No course was selected.';
      else
        select m.class_id
        into v_class_id
        from public.external_form_course_mappings m
        where m.provider = v_submission.provider
          and m.external_course_name = v_submission.selected_course
          and m.active = true
        for update;

        v_mapping_found := found;

        if not v_mapping_found then
          v_code := 'course_unmatched';
          v_note := 'The submitted course does not have an exact Forms mapping.';
        elsif v_class_id is null then
          v_code := 'course_unconfigured';
          v_note := 'The course mapping has not been linked to a real class.';
        else
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
          where c.id = v_class_id;

          if not found then
            v_code := 'class_not_found';
            v_note := 'The mapped class no longer exists.';
          elsif not v_class_active then
            v_code := 'class_inactive';
            v_note := 'The mapped class is archived.';
          elsif not v_registration_enabled then
            v_code := 'registration_disabled';
            v_note := 'The mapped class is not accepting applications.';
          elsif v_registration_opens_at is not null
                and now() < v_registration_opens_at then
            v_code := 'registration_not_open';
            v_note := 'Registration for the mapped class has not opened.';
          elsif v_registration_closes_at is not null
                and now() > v_registration_closes_at then
            v_code := 'registration_closed';
            v_note := 'Registration for the mapped class has closed.';
          else
            select a.id
            into v_application_id
            from public.applications a
            where a.student_id = v_student_id
              and a.class_id = v_class_id;

            if found then
              v_code := 'duplicate_application';
              v_note := 'This student already has an application for the mapped class.';
            else
              insert into public.applications (
                student_id,
                class_id,
                status,
                source,
                external_response_id,
                submitted_at
              ) values (
                v_student_id,
                v_class_id,
                'pending'::public.application_status,
                'microsoft_forms',
                v_submission.external_response_id,
                coalesce(v_submission.completed_at, v_submission.received_at)
              )
              on conflict (student_id, class_id) do nothing
              returning id into v_application_id;

              if v_application_id is null then
                select a.id
                into v_application_id
                from public.applications a
                where a.student_id = v_student_id
                  and a.class_id = v_class_id;

                v_code := 'duplicate_application';
                v_note := 'This student already has an application for the mapped class.';
              else
                v_status := 'processed';
                v_code := 'application_created';
                v_note := 'A pending application was created for administrator review.';
              end if;
            end if;
          end if;
        end if;
      end if;
    end if;
  end if;

  update public.external_form_submissions
  set processing_status = v_status,
      processing_code = v_code,
      processing_note = v_note,
      processed_at = case when v_status = 'processed' then now() else null end,
      matched_student_id = v_student_id,
      matched_class_id = v_class_id,
      application_id = v_application_id,
      attempt_count = v_attempt,
      last_attempted_at = now()
  where id = v_submission.id;

  insert into public.audit_log (
    actor_id,
    entity_type,
    entity_id,
    action,
    old_values,
    new_values
  ) values (
    p_actor_id,
    'external_form_submission',
    v_submission.id::text,
    case
      when v_attempt > 1 then 'external_form_reprocessed'
      when v_status = 'processed' then 'external_form_processed'
      else 'external_form_needs_review'
    end,
    jsonb_build_object(
      'processing_status', v_submission.processing_status,
      'processing_code', v_submission.processing_code,
      'attempt_count', v_submission.attempt_count
    ),
    jsonb_build_object(
      'processing_status', v_status,
      'processing_code', v_code,
      'attempt_count', v_attempt,
      'student_id', v_student_id,
      'class_id', v_class_id,
      'application_id', v_application_id
    )
  );

  return query
  select v_submission.id, v_status, v_code, v_application_id;
end;
$$;

revoke all on function public.process_external_form_submission(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.process_external_form_submission(uuid, uuid)
to service_role;
