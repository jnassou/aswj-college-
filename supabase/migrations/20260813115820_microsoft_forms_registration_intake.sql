-- Secure, recoverable Microsoft Forms intake.
-- Raw submissions are immutable. Derived mapping and processing fields may be
-- updated only by the server-side service role.

create table if not exists public.external_form_submissions (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  external_form_id text,
  external_response_id text not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processing_status text not null default 'pending'
    check (processing_status in ('pending', 'processed', 'needs_review', 'failed')),
  processed_at timestamptz,
  processing_note text,
  application_id uuid references public.applications(id)
);

alter table public.external_form_submissions
  add column if not exists payload_sha256 text,
  add column if not exists mapped_payload jsonb,
  add column if not exists validation_errors jsonb not null default '[]'::jsonb,
  add column if not exists normalized_email text,
  add column if not exists selected_course text,
  add column if not exists student_first_name text,
  add column if not exists student_last_name text,
  add column if not exists phone_number text,
  add column if not exists completed_at timestamptz,
  add column if not exists matched_student_id uuid
    references public.profiles(id) on delete set null,
  add column if not exists matched_class_id uuid
    references public.classes(id) on delete set null,
  add column if not exists attempt_count integer not null default 0,
  add column if not exists last_attempted_at timestamptz,
  add column if not exists processing_code text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.external_form_submissions'::regclass
      and conname = 'external_form_submissions_validation_errors_array_check'
  ) then
    alter table public.external_form_submissions
      add constraint external_form_submissions_validation_errors_array_check
      check (jsonb_typeof(validation_errors) = 'array');
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.external_form_submissions'::regclass
      and conname = 'external_form_submissions_attempt_count_check'
  ) then
    alter table public.external_form_submissions
      add constraint external_form_submissions_attempt_count_check
      check (attempt_count >= 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.external_form_submissions'::regclass
      and conname = 'external_form_submissions_payload_sha256_check'
  ) then
    alter table public.external_form_submissions
      add constraint external_form_submissions_payload_sha256_check
      check (payload_sha256 is null or payload_sha256 ~ '^[0-9a-f]{64}$');
  end if;
end;
$$;

alter table public.external_form_submissions
drop constraint if exists external_form_submissions_provider_external_response_id_key;

create unique index if not exists external_form_submissions_response_identity_idx
on public.external_form_submissions (
  provider,
  external_form_id,
  external_response_id
);

create index if not exists profiles_normalized_email_idx
on public.profiles ((lower(btrim(email))))
where nullif(btrim(email), '') is not null;

create index if not exists external_form_submissions_review_idx
on public.external_form_submissions (processing_status, received_at desc);

create index if not exists external_form_submissions_student_idx
on public.external_form_submissions (matched_student_id);

create index if not exists external_form_submissions_class_idx
on public.external_form_submissions (matched_class_id);

create table if not exists public.external_form_course_mappings (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  external_course_name text not null,
  class_id uuid references public.classes(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, external_course_name)
);

insert into public.external_form_course_mappings (
  provider,
  external_course_name
)
values
  ('microsoft_forms', 'Brothers Shariah Level 1 Wednesday Evening'),
  ('microsoft_forms', 'Brothers Shariah Level 3 Wednesday Evening'),
  ('microsoft_forms', 'Sisters Shariah Level 1 Thursday Morning'),
  ('microsoft_forms', 'Sisters Shariah Level 2 Thursday Morning'),
  ('microsoft_forms', 'Sisters Shariah Level 3 Wednesday Evening')
on conflict (provider, external_course_name) do nothing;

create or replace function public.protect_external_form_raw_submission()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.provider is distinct from old.provider
     or new.external_form_id is distinct from old.external_form_id
     or new.external_response_id is distinct from old.external_response_id
     or new.payload is distinct from old.payload
     or new.payload_sha256 is distinct from old.payload_sha256
     or new.received_at is distinct from old.received_at then
    raise exception 'Raw external form submissions are immutable';
  end if;

  return new;
end;
$$;

revoke all on function public.protect_external_form_raw_submission()
from public, anon, authenticated;

drop trigger if exists external_form_submissions_protect_raw
on public.external_form_submissions;
create trigger external_form_submissions_protect_raw
before update on public.external_form_submissions
for each row execute function public.protect_external_form_raw_submission();

create or replace function public.touch_external_course_mapping()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.touch_external_course_mapping()
from public, anon, authenticated;

drop trigger if exists external_course_mappings_touch_updated_at
on public.external_form_course_mappings;
create trigger external_course_mappings_touch_updated_at
before update on public.external_form_course_mappings
for each row execute function public.touch_external_course_mapping();

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
          select c.active
          into v_class_active
          from public.classes c
          where c.id = v_class_id;

          if not found then
            v_code := 'class_not_found';
            v_note := 'The mapped class no longer exists.';
          elsif not v_class_active then
            v_code := 'class_inactive';
            v_note := 'The mapped class is archived.';
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

create or replace function public.record_external_form_processing_failure(
  p_submission_id uuid,
  p_actor_id uuid default null,
  p_code text default 'processing_error',
  p_note text default 'The stored submission could not be processed automatically.',
  p_expected_attempt_count integer default null
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

  if p_expected_attempt_count is not null
     and v_submission.attempt_count <> p_expected_attempt_count then
    return query
    select
      v_submission.id,
      v_submission.processing_status,
      v_submission.processing_code,
      v_submission.application_id;
    return;
  end if;

  v_attempt := v_submission.attempt_count + 1;

  update public.external_form_submissions
  set processing_status = 'failed',
      processing_code = left(coalesce(nullif(btrim(p_code), ''), 'processing_error'), 100),
      processing_note = left(
        coalesce(
          nullif(btrim(p_note), ''),
          'The stored submission could not be processed automatically.'
        ),
        500
      ),
      processed_at = null,
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
    'external_form_failed',
    jsonb_build_object(
      'processing_status', v_submission.processing_status,
      'processing_code', v_submission.processing_code,
      'attempt_count', v_submission.attempt_count
    ),
    jsonb_build_object(
      'processing_status', 'failed',
      'processing_code', left(coalesce(nullif(btrim(p_code), ''), 'processing_error'), 100),
      'attempt_count', v_attempt
    )
  );

  return query
  select
    v_submission.id,
    'failed'::text,
    left(coalesce(nullif(btrim(p_code), ''), 'processing_error'), 100),
    v_submission.application_id;
end;
$$;

create or replace function public.admin_set_external_course_mapping(
  p_mapping_id uuid,
  p_class_id uuid,
  p_actor_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_mapping public.external_form_course_mappings%rowtype;
  v_class_active boolean;
begin
  if p_actor_id is null
     or not exists (
       select 1 from public.profiles p where p.id = p_actor_id
     ) then
    raise exception 'Administrator profile required' using errcode = '42501';
  end if;

  select m.*
  into v_mapping
  from public.external_form_course_mappings m
  where m.id = p_mapping_id
    and m.provider = 'microsoft_forms'
  for update;

  if not found then
    raise exception 'Course mapping not found' using errcode = 'P0002';
  end if;

  if not v_mapping.active then
    raise exception 'This course mapping is inactive';
  end if;

  if p_class_id is not null then
    select c.active
    into v_class_active
    from public.classes c
    where c.id = p_class_id;

    if not found then
      raise exception 'Class not found' using errcode = 'P0002';
    end if;

    if not v_class_active then
      raise exception 'Choose an active class';
    end if;
  end if;

  update public.external_form_course_mappings
  set class_id = p_class_id
  where id = v_mapping.id;

  insert into public.audit_log (
    actor_id,
    entity_type,
    entity_id,
    action,
    old_values,
    new_values
  ) values (
    p_actor_id,
    'external_form_course_mapping',
    v_mapping.id::text,
    'external_course_mapping_updated',
    jsonb_build_object('class_id', v_mapping.class_id),
    jsonb_build_object(
      'class_id', p_class_id,
      'external_course_name', v_mapping.external_course_name
    )
  );
end;
$$;

create or replace function public.admin_assign_external_submission_course(
  p_submission_id uuid,
  p_class_id uuid,
  p_actor_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_submission public.external_form_submissions%rowtype;
  v_course_name text;
  v_class_active boolean;
  v_mapping public.external_form_course_mappings%rowtype;
  v_mapping_id uuid;
  v_old_class_id uuid;
begin
  if p_actor_id is null
     or not exists (
       select 1 from public.profiles p where p.id = p_actor_id
     ) then
    raise exception 'Administrator profile required' using errcode = '42501';
  end if;

  select s.*
  into v_submission
  from public.external_form_submissions s
  where s.id = p_submission_id
    and s.provider = 'microsoft_forms'
  for update;

  if not found then
    raise exception 'Forms submission not found' using errcode = 'P0002';
  end if;

  if v_submission.processing_status = 'processed'
     and v_submission.application_id is not null then
    raise exception 'This Forms submission has already been processed';
  end if;

  v_course_name := v_submission.selected_course;

  if nullif(btrim(v_course_name), '') is null then
    raise exception 'The submission has no course to map';
  end if;

  select c.active
  into v_class_active
  from public.classes c
  where c.id = p_class_id;

  if not found then
    raise exception 'Class not found' using errcode = 'P0002';
  end if;

  if not v_class_active then
    raise exception 'Choose an active class';
  end if;

  select m.*
  into v_mapping
  from public.external_form_course_mappings m
  where m.provider = 'microsoft_forms'
    and m.external_course_name = v_course_name
  for update;

  if found then
    if not v_mapping.active then
      raise exception 'This course mapping is inactive';
    end if;

    v_mapping_id := v_mapping.id;
    v_old_class_id := v_mapping.class_id;

    update public.external_form_course_mappings
    set class_id = p_class_id
    where id = v_mapping.id;
  else
    begin
      insert into public.external_form_course_mappings (
        provider,
        external_course_name,
        class_id
      ) values (
        'microsoft_forms',
        v_course_name,
        p_class_id
      )
      returning id into v_mapping_id;
    exception
      when unique_violation then
        select m.*
        into v_mapping
        from public.external_form_course_mappings m
        where m.provider = 'microsoft_forms'
          and m.external_course_name = v_course_name
        for update;

        if not found or not v_mapping.active then
          raise exception 'This course mapping is inactive';
        end if;

        v_mapping_id := v_mapping.id;
        v_old_class_id := v_mapping.class_id;

        update public.external_form_course_mappings
        set class_id = p_class_id
        where id = v_mapping.id;
    end;
  end if;

  insert into public.audit_log (
    actor_id,
    entity_type,
    entity_id,
    action,
    old_values,
    new_values
  ) values (
    p_actor_id,
    'external_form_course_mapping',
    v_mapping_id::text,
    'external_course_mapping_updated',
    jsonb_build_object('class_id', v_old_class_id),
    jsonb_build_object(
      'class_id', p_class_id,
      'external_course_name', v_course_name,
      'submission_id', p_submission_id
    )
  );

  -- Keep the selected mapping and the resulting application in the same
  -- transaction so a concurrent remap cannot change the target class.
  perform public.process_external_form_submission(p_submission_id, p_actor_id);

  return v_mapping_id;
end;
$$;

alter table public.external_form_submissions enable row level security;
alter table public.external_form_course_mappings enable row level security;

revoke all on table public.external_form_submissions from anon, authenticated, service_role;
revoke all on table public.external_form_course_mappings from anon, authenticated, service_role;

grant select, insert on table public.external_form_submissions to service_role;
grant update (
  mapped_payload,
  validation_errors,
  normalized_email,
  selected_course,
  student_first_name,
  student_last_name,
  phone_number,
  completed_at,
  processing_status,
  processed_at,
  processing_note,
  application_id,
  matched_student_id,
  matched_class_id,
  attempt_count,
  last_attempted_at,
  processing_code
) on table public.external_form_submissions to service_role;
grant select, insert, update (class_id, updated_at)
on table public.external_form_course_mappings to service_role;
grant select on table public.profiles, public.classes, public.applications to service_role;
grant insert on table public.applications, public.audit_log to service_role;
grant usage, select on sequence public.audit_log_id_seq to service_role;

revoke all on function public.process_external_form_submission(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.process_external_form_submission(uuid, uuid)
to service_role;

revoke all on function public.record_external_form_processing_failure(uuid, uuid, text, text, integer)
from public, anon, authenticated;
grant execute on function public.record_external_form_processing_failure(uuid, uuid, text, text, integer)
to service_role;

revoke all on function public.admin_set_external_course_mapping(uuid, uuid, uuid)
from public, anon, authenticated;
grant execute on function public.admin_set_external_course_mapping(uuid, uuid, uuid)
to service_role;

revoke all on function public.admin_assign_external_submission_course(uuid, uuid, uuid)
from public, anon, authenticated;
grant execute on function public.admin_assign_external_submission_course(uuid, uuid, uuid)
to service_role;
