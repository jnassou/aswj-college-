-- Editable, versioned operational-email templates.
--
-- Template revisions are immutable. Each outbox delivery pins the active
-- revision when it is queued, so a later administrator edit can only affect
-- future events. Account confirmation itself remains owned by Supabase Auth;
-- the account_welcome message is queued only after Auth confirms the email.

create table private.email_templates (
  template_key text primary key check (
    template_key in (
      'account_welcome',
      'application_received',
      'application_accepted',
      'application_waitlisted',
      'application_declined',
      'enrolment_suspended',
      'enrolment_reinstated'
    )
  ),
  category text not null check (
    category in ('account', 'application', 'enrolment')
  ),
  event_label text not null check (char_length(event_label) between 1 and 80),
  sent_when text not null check (char_length(sent_when) between 1 and 240),
  allowed_variables text[] not null,
  active_version_id uuid,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint email_templates_allowed_variables_nonempty
    check (cardinality(allowed_variables) > 0)
);

create table private.email_template_versions (
  id uuid primary key default gen_random_uuid(),
  template_key text not null
    references private.email_templates(template_key) on delete restrict,
  version_number integer not null check (version_number > 0),
  subject_template text not null
    check (char_length(subject_template) between 1 and 160),
  preview_template text not null
    check (char_length(preview_template) between 1 and 200),
  heading_template text not null
    check (char_length(heading_template) between 1 and 120),
  body_template text not null
    check (char_length(body_template) between 1 and 5000),
  button_label text not null
    check (char_length(button_label) between 1 and 80),
  is_default boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint email_template_versions_number_unique
    unique (template_key, version_number),
  constraint email_template_versions_template_id_unique
    unique (template_key, id)
);

create unique index email_template_versions_one_default_idx
on private.email_template_versions (template_key)
where is_default;

create index email_templates_updated_by_idx
on private.email_templates (updated_by)
where updated_by is not null;

create index email_template_versions_created_by_idx
on private.email_template_versions (created_by)
where created_by is not null;

create table private.pending_account_welcome_emails (
  student_id uuid primary key
    references public.profiles(id) on delete cascade,
  confirmed_at timestamptz not null,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_attempt_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table private.pending_account_welcome_emails is
  'Durable reconciliation marker for a confirmed student whose welcome outbox event has not yet been created.';

comment on table private.email_templates is
  'Private catalogue of operational email templates and their active immutable revision.';
comment on table private.email_template_versions is
  'Immutable operational email copy. Revisions contain presentation copy only and never recipient data.';

alter table private.email_templates enable row level security;
alter table private.email_template_versions enable row level security;
alter table private.pending_account_welcome_emails enable row level security;

revoke all on table private.email_templates
from public, anon, authenticated, service_role;
revoke all on table private.email_template_versions
from public, anon, authenticated, service_role;
revoke all on table private.pending_account_welcome_emails
from public, anon, authenticated, service_role;

create or replace function private.prevent_email_template_version_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and old.id is not distinct from new.id
     and old.template_key is not distinct from new.template_key
     and old.version_number is not distinct from new.version_number
     and old.subject_template is not distinct from new.subject_template
     and old.preview_template is not distinct from new.preview_template
     and old.heading_template is not distinct from new.heading_template
     and old.body_template is not distinct from new.body_template
     and old.button_label is not distinct from new.button_label
     and old.is_default is not distinct from new.is_default
     and old.created_at is not distinct from new.created_at
     and old.created_by is not null
     and new.created_by is null then
    -- Permit only the FK's ON DELETE SET NULL cleanup. Message copy and all
    -- revision identity fields remain immutable.
    return new;
  end if;

  raise exception 'Email template revisions are immutable'
    using errcode = '55000';
end;
$$;

revoke all on function private.prevent_email_template_version_mutation()
from public, anon, authenticated, service_role;

create trigger email_template_versions_are_immutable
before update or delete on private.email_template_versions
for each row execute function private.prevent_email_template_version_mutation();

insert into private.email_templates (
  template_key,
  category,
  event_label,
  sent_when,
  allowed_variables
) values
  (
    'account_welcome',
    'account',
    'Account welcome',
    'After a student confirms their email address',
    array['first_name', 'student_portal_url']::text[]
  ),
  (
    'application_received',
    'application',
    'Application received',
    'Immediately after a student submits an application',
    array[
      'first_name', 'class_name', 'class_term', 'class_label',
      'student_portal_url'
    ]::text[]
  ),
  (
    'application_accepted',
    'application',
    'Application accepted',
    'When an administrator accepts an application',
    array[
      'first_name', 'class_name', 'class_term', 'class_label',
      'student_portal_url'
    ]::text[]
  ),
  (
    'application_waitlisted',
    'application',
    'Application waitlisted',
    'When an administrator places an application on the waiting list',
    array[
      'first_name', 'class_name', 'class_term', 'class_label',
      'waitlist_position', 'waitlist_position_text', 'student_portal_url'
    ]::text[]
  ),
  (
    'application_declined',
    'application',
    'Application update',
    'When an administrator declines an application',
    array[
      'first_name', 'class_name', 'class_term', 'class_label',
      'student_portal_url'
    ]::text[]
  ),
  (
    'enrolment_suspended',
    'enrolment',
    'Enrolment suspended',
    'When an administrator suspends an enrolment',
    array[
      'first_name', 'class_name', 'class_term', 'class_label',
      'student_portal_url'
    ]::text[]
  ),
  (
    'enrolment_reinstated',
    'enrolment',
    'Enrolment reinstated',
    'When an administrator reinstates an enrolment',
    array[
      'first_name', 'class_name', 'class_term', 'class_label',
      'student_portal_url'
    ]::text[]
  )
on conflict (template_key) do nothing;

insert into private.email_template_versions (
  template_key,
  version_number,
  subject_template,
  preview_template,
  heading_template,
  body_template,
  button_label,
  is_default
) values
  (
    'account_welcome',
    1,
    'Welcome to ASWJ College',
    'Your ASWJ College student account is ready.',
    'Welcome to ASWJ College',
    $template$Assalamu alaikum {{first_name}},

Your email address has been confirmed and your ASWJ College student account is ready.

You can now sign in, apply for available classes and view your application updates in the Student Portal.$template$,
    'Open Student Portal',
    true
  ),
  (
    'application_received',
    1,
    'We received your ASWJ College application',
    'Your application for {{class_label}} is awaiting review.',
    'Application received',
    $template$Assalamu alaikum {{first_name}},

We have received your application for {{class_label}}.

It is now awaiting an administrator review. We will send another update when a decision is recorded.$template$,
    'Open Student Portal',
    true
  ),
  (
    'application_accepted',
    1,
    'Your ASWJ College application was accepted',
    'Your application for {{class_label}} has been accepted.',
    'Application accepted',
    $template$Assalamu alaikum {{first_name}},

Your application for {{class_label}} has been accepted.

Your active class enrolment and available class details are shown in the Student Portal.$template$,
    'Open Student Portal',
    true
  ),
  (
    'application_waitlisted',
    1,
    'Your ASWJ College application is on the waiting list',
    'You have been placed on the waiting list for {{class_label}}.',
    'Waiting list update',
    $template$Assalamu alaikum {{first_name}},

You have been placed on the waiting list for {{class_label}}.{{waitlist_position_text}}

The Student Portal will show your latest application status.$template$,
    'Open Student Portal',
    true
  ),
  (
    'application_declined',
    1,
    'Update on your ASWJ College application',
    'A place was not offered for {{class_label}}.',
    'Application update',
    $template$Assalamu alaikum {{first_name}},

A place was not offered for your application to {{class_label}}.

If you need more information, reply to this email to contact administration.$template$,
    'Open Student Portal',
    true
  ),
  (
    'enrolment_suspended',
    1,
    'Your ASWJ College enrolment was suspended',
    'Your enrolment in {{class_label}} has been suspended.',
    'Enrolment suspended',
    $template$Assalamu alaikum {{first_name}},

Your enrolment in {{class_label}} has been suspended.

Sign in to the Student Portal for your current enrolment status, or reply to this email to contact administration.$template$,
    'Open Student Portal',
    true
  ),
  (
    'enrolment_reinstated',
    1,
    'Your ASWJ College enrolment is active again',
    'Your enrolment in {{class_label}} has been reinstated.',
    'Enrolment reinstated',
    $template$Assalamu alaikum {{first_name}},

Your enrolment in {{class_label}} has been reinstated and is active again.

Your current enrolment and class details are available in the Student Portal.$template$,
    'Open Student Portal',
    true
  )
on conflict (template_key, version_number) do nothing;

update private.email_templates t
set active_version_id = v.id
from private.email_template_versions v
where v.template_key = t.template_key
  and v.is_default
  and t.active_version_id is null;

alter table private.email_templates
  alter column active_version_id set not null;

alter table private.email_templates
  add constraint email_templates_active_version_same_template_fk
  foreign key (template_key, active_version_id)
  references private.email_template_versions(template_key, id)
  on delete restrict;

alter table private.email_deliveries
  add column template_revision_id uuid;

-- Existing rendered and unrendered deliveries are pinned to the matching
-- seeded revision without changing their rendered snapshots or send state.
update private.email_deliveries d
set template_revision_id = t.active_version_id
from private.email_templates t
where t.template_key = d.template_key
  and d.template_revision_id is null;

alter table private.email_deliveries
  alter column template_revision_id set not null;

alter table private.email_deliveries
  add constraint email_deliveries_template_revision_same_template_fk
  foreign key (template_key, template_revision_id)
  references private.email_template_versions(template_key, id)
  on delete restrict;

create index email_deliveries_template_revision_idx
on private.email_deliveries (template_key, template_revision_id);

alter table private.email_deliveries
  drop constraint if exists email_deliveries_source_kind_check;
alter table private.email_deliveries
  add constraint email_deliveries_source_kind_check
  check (source_kind in ('account', 'application', 'notification'));

alter table private.email_deliveries
  drop constraint if exists email_deliveries_template_key_check;
alter table private.email_deliveries
  add constraint email_deliveries_template_key_check
  check (
    template_key in (
      'account_welcome',
      'application_received',
      'application_accepted',
      'application_waitlisted',
      'application_declined',
      'enrolment_suspended',
      'enrolment_reinstated'
    )
  );

-- Older deployments did not enforce the full source-ID relationship. Hold any
-- malformed, unsent legacy row for review before installing the stricter rule;
-- never rewrite its historical identity or abort the whole migration.
update private.email_deliveries d
set dispatch_status = 'blocked',
    lease_worker_id = null,
    lease_expires_at = null,
    last_error_code = 'legacy_source_invalid',
    last_error_message = 'This legacy delivery has an invalid source relationship and requires review.',
    updated_at = now()
where d.provider_email_id is null
  and d.provider_submission_started_at is null
  and d.dispatch_status in ('queued', 'retry_scheduled', 'processing')
  and (
    (
      source_kind = 'application'
      and template_key = 'application_received'
      and application_id is not null
      and application_id = source_id
      and notification_id is null
      and enrolment_id is null
    )
    or (
      source_kind = 'notification'
      and notification_id is not null
      and notification_id = source_id
      and (
        (
          template_key in (
            'application_accepted',
            'application_waitlisted',
            'application_declined'
          )
          and application_id is not null
        )
        or (
          template_key in ('enrolment_suspended', 'enrolment_reinstated')
          and enrolment_id is not null
        )
      )
    )
  ) is not true;

alter table private.email_deliveries
  add constraint email_deliveries_source_template_check
  check ((
    (
      source_kind = 'account'
      and template_key = 'account_welcome'
      and source_id = student_id
      and notification_id is null
      and application_id is null
      and enrolment_id is null
    )
    or (
      source_kind = 'application'
      and template_key = 'application_received'
      and application_id is not null
      and application_id = source_id
      and notification_id is null
      and enrolment_id is null
    )
    or (
      source_kind = 'notification'
      and notification_id is not null
      and notification_id = source_id
      and (
        (
          template_key in (
            'application_accepted',
            'application_waitlisted',
            'application_declined'
          )
          and application_id is not null
        )
        or (
          template_key in ('enrolment_suspended', 'enrolment_reinstated')
          and enrolment_id is not null
        )
      )
    )
  ) is true) not valid;

-- A clean deployment validates the constraint immediately. If a submitted or
-- otherwise historical malformed row exists, future writes are still checked
-- while that immutable evidence remains available for deliberate remediation.
do $$
begin
  if not exists (
    select 1
    from private.email_deliveries d
    where (
      (
        d.source_kind = 'account'
        and d.template_key = 'account_welcome'
        and d.source_id = d.student_id
        and d.notification_id is null
        and d.application_id is null
        and d.enrolment_id is null
      )
      or (
        d.source_kind = 'application'
        and d.template_key = 'application_received'
        and d.application_id is not null
        and d.application_id = d.source_id
        and d.notification_id is null
        and d.enrolment_id is null
      )
      or (
        d.source_kind = 'notification'
        and d.notification_id is not null
        and d.notification_id = d.source_id
        and (
          (
            d.template_key in (
              'application_accepted',
              'application_waitlisted',
              'application_declined'
            )
            and d.application_id is not null
          )
          or (
            d.template_key in (
              'enrolment_suspended',
              'enrolment_reinstated'
            )
            and d.enrolment_id is not null
          )
        )
      )
    ) is not true
  ) then
    alter table private.email_deliveries
      validate constraint email_deliveries_source_template_check;
  end if;
end;
$$;

create or replace function private.enqueue_email_delivery_v1(
  p_source_kind text,
  p_source_id uuid,
  p_template_key text,
  p_student_id uuid,
  p_notification_id uuid default null,
  p_application_id uuid default null,
  p_enrolment_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_first_name text;
  v_recipient_email text;
  v_class_name text;
  v_class_term text;
  v_class_location text;
  v_class_day smallint;
  v_class_start time;
  v_class_end time;
  v_waitlist_position integer;
  v_dispatch_status text;
  v_template_revision_id uuid;
begin
  if p_source_id is null
     or p_student_id is null
     or (
       (
         p_source_kind = 'account'
         and p_template_key = 'account_welcome'
         and p_source_id = p_student_id
         and p_notification_id is null
         and p_application_id is null
         and p_enrolment_id is null
       )
       or (
         p_source_kind = 'application'
         and p_template_key = 'application_received'
         and p_application_id is not null
         and p_application_id = p_source_id
         and p_notification_id is null
         and p_enrolment_id is null
       )
       or (
         p_source_kind = 'notification'
         and p_notification_id is not null
         and p_notification_id = p_source_id
         and (
           (
             p_template_key in (
               'application_accepted',
               'application_waitlisted',
               'application_declined'
             )
             and p_application_id is not null
           )
           or (
             p_template_key in (
               'enrolment_suspended',
               'enrolment_reinstated'
             )
             and p_enrolment_id is not null
           )
         )
       )
     ) is not true then
    raise exception 'Invalid email outbox source';
  end if;

  select t.active_version_id
  into v_template_revision_id
  from private.email_templates t
  where t.template_key = p_template_key;

  if v_template_revision_id is null then
    raise exception 'Active email template not found';
  end if;

  select
    nullif(btrim(p.first_name), ''),
    nullif(lower(btrim(p.email)), ''),
    c.name,
    c.term,
    c.location,
    c.day_of_week,
    c.start_time,
    c.end_time,
    a.waitlist_position
  into
    v_first_name,
    v_recipient_email,
    v_class_name,
    v_class_term,
    v_class_location,
    v_class_day,
    v_class_start,
    v_class_end,
    v_waitlist_position
  from public.profiles p
  left join public.applications a on a.id = p_application_id
  left join public.enrolments e on e.id = p_enrolment_id
  left join public.classes c on c.id = coalesce(a.class_id, e.class_id)
  where p.id = p_student_id;

  if not found then
    raise exception 'Email outbox student not found';
  end if;

  v_dispatch_status := case
    when v_recipient_email is null then 'blocked'
    else 'queued'
  end;

  insert into private.email_deliveries (
    source_kind,
    source_id,
    notification_id,
    application_id,
    enrolment_id,
    student_id,
    template_key,
    template_revision_id,
    recipient_email,
    template_payload,
    dispatch_status,
    last_error_code,
    last_error_message
  ) values (
    p_source_kind,
    p_source_id,
    p_notification_id,
    p_application_id,
    p_enrolment_id,
    p_student_id,
    p_template_key,
    v_template_revision_id,
    v_recipient_email,
    jsonb_strip_nulls(jsonb_build_object(
      'first_name', coalesce(v_first_name, 'Student'),
      'class_name', v_class_name,
      'class_term', v_class_term,
      'class_location', v_class_location,
      'class_day_of_week', v_class_day,
      'class_start_time', v_class_start,
      'class_end_time', v_class_end,
      'waitlist_position', v_waitlist_position
    )),
    v_dispatch_status,
    case when v_recipient_email is null then 'recipient_missing' end,
    case when v_recipient_email is null
      then 'No student email address was available when this event was queued.'
    end
  )
  on conflict (source_kind, source_id, template_key) do nothing;
end;
$$;

revoke all on function private.enqueue_email_delivery_v1(
  text, uuid, text, uuid, uuid, uuid, uuid
)
from public, anon, authenticated, service_role;

create or replace function private.queue_account_welcome_v1(
  p_student_id uuid,
  p_confirmed_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_student_id is null or p_confirmed_at is null then
    raise exception 'Confirmed student identifier is required';
  end if;

  insert into private.pending_account_welcome_emails (
    student_id,
    confirmed_at
  ) values (
    p_student_id,
    p_confirmed_at
  )
  on conflict (student_id) do update
  set confirmed_at = least(
        private.pending_account_welcome_emails.confirmed_at,
        excluded.confirmed_at
      ),
      updated_at = now();

  begin
    perform private.enqueue_email_delivery_v1(
      'account',
      p_student_id,
      'account_welcome',
      p_student_id,
      null,
      null,
      null
    );

    -- Recovery must not turn an old confirmation into a surprise welcome
    -- months later. Preserve the original seven-day window for this event.
    update private.email_deliveries d
    set expires_at = least(
          d.expires_at,
          p_confirmed_at + interval '7 days'
        ),
        dispatch_status = case
          when p_confirmed_at + interval '7 days' <= now()
            then 'blocked'
          else d.dispatch_status
        end,
        last_error_code = case
          when p_confirmed_at + interval '7 days' <= now()
            then 'expired'
          else d.last_error_code
        end,
        last_error_message = case
          when p_confirmed_at + interval '7 days' <= now()
            then 'This welcome passed its seven-day sending window.'
          else d.last_error_message
        end,
        updated_at = now()
    where d.source_kind = 'account'
      and d.source_id = p_student_id
      and d.template_key = 'account_welcome'
      and d.dispatch_status in ('queued', 'blocked')
      and d.provider_submission_started_at is null;

    delete from private.pending_account_welcome_emails p
    where p.student_id = p_student_id;
  exception when others then
    update private.pending_account_welcome_emails p
    set attempt_count = p.attempt_count + 1,
        last_attempt_at = now(),
        updated_at = now()
    where p.student_id = p_student_id;

    raise warning 'Account welcome email was deferred for reconciliation';
  end;
end;
$$;

revoke all on function private.queue_account_welcome_v1(uuid, timestamptz)
from public, anon, authenticated, service_role;

create or replace function private.reconcile_account_welcome_emails_v1(
  p_limit integer default 25
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pending record;
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
begin
  for v_pending in
    select p.student_id, p.confirmed_at
    from private.pending_account_welcome_emails p
    order by p.created_at, p.student_id
    for update skip locked
    limit v_limit
  loop
    perform private.queue_account_welcome_v1(
      v_pending.student_id,
      v_pending.confirmed_at
    );
  end loop;
end;
$$;

revoke all on function private.reconcile_account_welcome_emails_v1(integer)
from public, anon, authenticated, service_role;
grant execute on function private.reconcile_account_welcome_emails_v1(integer)
to service_role;

-- Preserve the existing profile-sync behaviour while adding one welcome event
-- after a user is already confirmed. This is deliberately not an Auth
-- confirmation email and contains no sign-in token.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, role, first_name, last_name, email, mobile)
  values (
    new.id,
    'student'::public.user_role,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'first_name'), ''), 'Student'),
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'last_name'), ''), ''),
    new.email,
    nullif(trim(coalesce(new.phone, new.raw_user_meta_data ->> 'mobile', '')), '')
  )
  on conflict (id) do update set
    email = excluded.email,
    mobile = coalesce(excluded.mobile, public.profiles.mobile),
    updated_at = now();

  if new.email_confirmed_at is not null
     and coalesce(new.raw_user_meta_data ->> 'account_type', '') = 'student' then
    begin
      perform private.queue_account_welcome_v1(
        new.id,
        new.email_confirmed_at
      );
    exception when others then
      -- Operational email must never prevent an Auth user from being created.
      raise warning 'Account welcome reconciliation marker could not be created';
    end;
  end if;

  return new;
end;
$$;

revoke all on function public.handle_new_user()
from public, anon, authenticated, service_role;

create or replace function public.sync_auth_user_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
  set email = new.email,
      mobile = coalesce(
        nullif(trim(coalesce(new.phone, new.raw_user_meta_data ->> 'mobile', '')), ''),
        mobile
      ),
      first_name = coalesce(
        nullif(trim(new.raw_user_meta_data ->> 'first_name'), ''),
        first_name
      ),
      last_name = coalesce(
        nullif(trim(new.raw_user_meta_data ->> 'last_name'), ''),
        last_name
      ),
      updated_at = now()
  where id = new.id;

  if old.email_confirmed_at is null
     and new.email_confirmed_at is not null
     and coalesce(new.raw_user_meta_data ->> 'account_type', '') = 'student' then
    begin
      perform private.queue_account_welcome_v1(
        new.id,
        new.email_confirmed_at
      );
    exception when others then
      -- Confirmation and profile sync remain available during email outages.
      raise warning 'Account welcome reconciliation marker could not be created';
    end;
  end if;

  return new;
end;
$$;

revoke all on function public.sync_auth_user_profile()
from public, anon, authenticated, service_role;

drop trigger if exists on_auth_user_updated on auth.users;
create trigger on_auth_user_updated
after update of email, phone, raw_user_meta_data, email_confirmed_at
on auth.users
for each row execute function public.sync_auth_user_profile();

create or replace function public.claim_email_deliveries(
  p_worker_id uuid,
  p_batch_limit integer default 5,
  p_lease_seconds integer default 120
)
returns table (
  delivery_id uuid,
  template_key text,
  recipient_email text,
  template_payload jsonb,
  attempt_count integer,
  template_version text,
  email_subject text,
  html_body text,
  text_body text
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_limit integer;
  v_lease_seconds integer;
begin
  if p_worker_id is null then
    raise exception 'Worker identifier is required';
  end if;

  v_limit := least(greatest(coalesce(p_batch_limit, 5), 1), 10);
  v_lease_seconds := least(greatest(coalesce(p_lease_seconds, 120), 30), 600);

  -- Recover any confirmed-student welcome event whose first enqueue attempt
  -- failed. The marker remains durable until an idempotent outbox row exists.
  perform private.reconcile_account_welcome_emails_v1(25);

  update private.email_deliveries d
  set dispatch_status = 'blocked',
      lease_worker_id = null,
      lease_expires_at = null,
      last_error_code = 'expired',
      last_error_message = 'This delivery passed its approved seven-day sending window.',
      updated_at = now()
  where d.expires_at <= now()
    and (
      d.dispatch_status in ('queued', 'retry_scheduled')
      or (d.dispatch_status = 'processing' and d.lease_expires_at <= now())
    );

  update private.email_deliveries d
  set dispatch_status = 'failed',
      lease_worker_id = null,
      lease_expires_at = null,
      last_error_code = 'idempotency_window_expired',
      last_error_message = 'The provider acceptance state could not be confirmed within the safe retry window.',
      updated_at = now()
  where d.provider_email_id is null
    and d.provider_submission_started_at <= now() - interval '23 hours'
    and (
      d.dispatch_status in ('queued', 'retry_scheduled')
      or (d.dispatch_status = 'processing' and d.lease_expires_at <= now())
    );

  update private.email_deliveries d
  set dispatch_status = case
        when d.attempt_cycle_count >= 7 then 'failed'
        else 'retry_scheduled'
      end,
      next_attempt_at = now(),
      lease_worker_id = null,
      lease_expires_at = null,
      last_error_code = case
        when d.attempt_cycle_count >= 7 then 'attempt_limit_reached'
        else d.last_error_code
      end,
      last_error_message = case
        when d.attempt_cycle_count >= 7
          then 'The automatic email retry limit was reached.'
        else d.last_error_message
      end,
      updated_at = now()
  where d.dispatch_status = 'processing'
    and d.lease_expires_at <= now()
    and d.expires_at > now()
    and (
      d.provider_submission_started_at is null
      or d.provider_submission_started_at > now() - interval '23 hours'
    );

  update private.email_deliveries d
  set dispatch_status = 'blocked',
      lease_worker_id = null,
      lease_expires_at = null,
      last_error_code = 'superseded',
      last_error_message = 'A newer student record state superseded this email.',
      updated_at = now()
  where d.dispatch_status in ('queued', 'retry_scheduled')
    and (
      (
        d.template_key in (
          'application_received',
          'application_accepted',
          'application_waitlisted',
          'application_declined'
        )
        and not exists (
          select 1
          from public.applications a
          where a.id = d.application_id
            and a.status::text = case d.template_key
              when 'application_received' then 'pending'
              when 'application_accepted' then 'accepted'
              when 'application_waitlisted' then 'waitlisted'
              when 'application_declined' then 'declined'
            end
        )
      )
      or (
        d.template_key in ('enrolment_suspended', 'enrolment_reinstated')
        and not exists (
          select 1
          from public.enrolments e
          where e.id = d.enrolment_id
            and e.status::text = case d.template_key
              when 'enrolment_suspended' then 'suspended'
              when 'enrolment_reinstated' then 'enrolled'
            end
        )
      )
    );

  return query
  with candidates as (
    select d.id
    from private.email_deliveries d
    where d.dispatch_status in ('queued', 'retry_scheduled')
      and d.next_attempt_at <= now()
      and d.expires_at > now()
      and d.attempt_cycle_count < 7
      and d.recipient_email is not null
      and (
        d.provider_submission_started_at is null
        or d.provider_submission_started_at > now() - interval '23 hours'
      )
      and (
        d.template_key = 'account_welcome'
        or (
          d.template_key in (
            'application_received',
            'application_accepted',
            'application_waitlisted',
            'application_declined'
          )
          and exists (
            select 1
            from public.applications a
            where a.id = d.application_id
              and a.status::text = case d.template_key
                when 'application_received' then 'pending'
                when 'application_accepted' then 'accepted'
                when 'application_waitlisted' then 'waitlisted'
                when 'application_declined' then 'declined'
              end
          )
        )
        or (
          d.template_key in ('enrolment_suspended', 'enrolment_reinstated')
          and exists (
            select 1
            from public.enrolments e
            where e.id = d.enrolment_id
              and e.status::text = case d.template_key
                when 'enrolment_suspended' then 'suspended'
                when 'enrolment_reinstated' then 'enrolled'
              end
          )
        )
      )
    order by d.next_attempt_at, d.queued_at, d.id
    for update skip locked
    limit v_limit
  ), claimed as (
    update private.email_deliveries d
    set dispatch_status = 'processing',
        attempt_count = d.attempt_count + 1,
        attempt_cycle_count = d.attempt_cycle_count + 1,
        lease_worker_id = p_worker_id,
        lease_expires_at = now() + make_interval(secs => v_lease_seconds),
        first_attempt_at = coalesce(d.first_attempt_at, now()),
        last_attempt_at = now(),
        updated_at = now()
    from candidates c
    where d.id = c.id
    returning
      d.id,
      d.template_key,
      d.recipient_email,
      d.template_payload,
      d.attempt_cycle_count as attempt_count,
      d.template_version,
      d.email_subject,
      d.html_body,
      d.text_body
  )
  select
    claimed.id,
    claimed.template_key,
    claimed.recipient_email,
    claimed.template_payload,
    claimed.attempt_count,
    claimed.template_version,
    claimed.email_subject,
    claimed.html_body,
    claimed.text_body
  from claimed;
end;
$$;

revoke all on function public.claim_email_deliveries(uuid, integer, integer)
from public, anon, authenticated, service_role;
grant execute on function public.claim_email_deliveries(uuid, integer, integer)
to service_role;

create or replace function public.get_email_template_for_delivery(
  p_delivery_id uuid,
  p_worker_id uuid
)
returns table (
  template_revision_id uuid,
  template_key text,
  template_version text,
  subject_template text,
  preview_template text,
  heading_template text,
  body_template text,
  button_label text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_delivery_id is null or p_worker_id is null then
    raise exception 'Delivery and worker identifiers are required';
  end if;

  return query
  select
    v.id,
    v.template_key,
    'db:' || v.id::text,
    v.subject_template,
    v.preview_template,
    v.heading_template,
    v.body_template,
    v.button_label
  from private.email_deliveries d
  join private.email_template_versions v
    on v.id = d.template_revision_id
   and v.template_key = d.template_key
  where d.id = p_delivery_id
    and d.dispatch_status = 'processing'
    and d.lease_worker_id = p_worker_id
    and d.lease_expires_at > now();

  if not found then
    raise exception 'Email delivery lease is not current'
      using errcode = '40001';
  end if;
end;
$$;

revoke all on function public.get_email_template_for_delivery(uuid, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.get_email_template_for_delivery(uuid, uuid)
to service_role;

create or replace function private.validate_email_template_content_v1(
  p_allowed_variables text[],
  p_subject_template text,
  p_preview_template text,
  p_heading_template text,
  p_body_template text,
  p_button_label text
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_body text := replace(
    replace(coalesce(p_body_template, ''), E'\r\n', E'\n'),
    E'\r',
    E'\n'
  );
  v_remaining text;
  v_variable text;
begin
  if nullif(btrim(p_subject_template), '') is null
     or char_length(btrim(p_subject_template)) > 160
     or p_subject_template ~ '[[:cntrl:]]'
     or nullif(btrim(p_preview_template), '') is null
     or char_length(btrim(p_preview_template)) > 200
     or p_preview_template ~ '[[:cntrl:]]'
     or nullif(btrim(p_heading_template), '') is null
     or char_length(btrim(p_heading_template)) > 120
     or p_heading_template ~ '[[:cntrl:]]'
     or nullif(btrim(v_body), '') is null
     or char_length(btrim(v_body)) > 5000
     or replace(v_body, E'\n', '') ~ '[[:cntrl:]]'
     or nullif(btrim(p_button_label), '') is null
     or char_length(btrim(p_button_label)) > 80
     or p_button_label ~ '[[:cntrl:]]' then
    raise exception 'Invalid email template content';
  end if;

  v_remaining := concat_ws(
    E'\n',
    p_subject_template,
    p_preview_template,
    p_heading_template,
    v_body,
    p_button_label
  );

  foreach v_variable in array p_allowed_variables loop
    v_remaining := replace(
      v_remaining,
      '{{' || v_variable || '}}',
      ''
    );
  end loop;

  if v_remaining ~ '\{\{|\}\}' then
    raise exception 'Email template contains an unknown or malformed variable';
  end if;
end;
$$;

revoke all on function private.validate_email_template_content_v1(
  text[], text, text, text, text, text
)
from public, anon, authenticated, service_role;

create or replace function private.admin_list_email_templates_v1()
returns table (
  template_key text,
  category text,
  event_label text,
  sent_when text,
  allowed_variables text[],
  active_version integer,
  subject_template text,
  preview_template text,
  heading_template text,
  body_template text,
  button_label text,
  updated_at timestamptz
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
    t.template_key,
    t.category,
    t.event_label,
    t.sent_when,
    t.allowed_variables,
    v.version_number,
    v.subject_template,
    v.preview_template,
    v.heading_template,
    v.body_template,
    v.button_label,
    t.updated_at
  from private.email_templates t
  join private.email_template_versions v
    on v.id = t.active_version_id
   and v.template_key = t.template_key
  order by
    case t.category
      when 'account' then 1
      when 'application' then 2
      when 'enrolment' then 3
      else 4
    end,
    t.event_label,
    t.template_key;
end;
$$;

revoke all on function private.admin_list_email_templates_v1()
from public, anon, authenticated, service_role;
grant execute on function private.admin_list_email_templates_v1()
to authenticated;

create or replace function public.admin_list_email_templates()
returns table (
  template_key text,
  category text,
  event_label text,
  sent_when text,
  allowed_variables text[],
  active_version integer,
  subject_template text,
  preview_template text,
  heading_template text,
  body_template text,
  button_label text,
  updated_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.admin_list_email_templates_v1();
$$;

revoke all on function public.admin_list_email_templates()
from public, anon, authenticated, service_role;
grant execute on function public.admin_list_email_templates()
to authenticated;

create or replace function private.admin_update_email_template_v1(
  p_template_key text,
  p_expected_version integer,
  p_subject_template text,
  p_preview_template text,
  p_heading_template text,
  p_body_template text,
  p_button_label text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_active_revision_id uuid;
  v_active_version integer;
  v_allowed_variables text[];
  v_new_revision_id uuid;
  v_new_version integer;
  v_body text;
begin
  if v_actor is null
     or coalesce(auth.jwt()->'app_metadata'->>'role', '')
       not in ('admin', 'super_admin') then
    raise exception 'Administrator access required'
      using errcode = '42501';
  end if;

  select t.active_version_id, v.version_number, t.allowed_variables
  into v_active_revision_id, v_active_version, v_allowed_variables
  from private.email_templates t
  join private.email_template_versions v
    on v.id = t.active_version_id
   and v.template_key = t.template_key
  where t.template_key = p_template_key
  for update of t;

  if not found then
    raise exception 'Email template not found';
  end if;

  if p_expected_version is null or p_expected_version <> v_active_version then
    return false;
  end if;

  perform private.validate_email_template_content_v1(
    v_allowed_variables,
    p_subject_template,
    p_preview_template,
    p_heading_template,
    p_body_template,
    p_button_label
  );

  select coalesce(max(v.version_number), 0) + 1
  into v_new_version
  from private.email_template_versions v
  where v.template_key = p_template_key;

  v_body := btrim(
    replace(replace(p_body_template, E'\r\n', E'\n'), E'\r', E'\n'),
    E' \t\n'
  );

  insert into private.email_template_versions (
    template_key,
    version_number,
    subject_template,
    preview_template,
    heading_template,
    body_template,
    button_label,
    is_default,
    created_by
  ) values (
    p_template_key,
    v_new_version,
    btrim(p_subject_template),
    btrim(p_preview_template),
    btrim(p_heading_template),
    v_body,
    btrim(p_button_label),
    false,
    v_actor
  )
  returning id into v_new_revision_id;

  update private.email_templates t
  set active_version_id = v_new_revision_id,
      updated_by = v_actor,
      updated_at = now()
  where t.template_key = p_template_key;

  insert into public.audit_log (
    actor_id,
    entity_type,
    entity_id,
    action,
    old_values,
    new_values
  ) values (
    v_actor,
    'email_template',
    p_template_key,
    'email_template_updated',
    jsonb_build_object(
      'revision_id', v_active_revision_id,
      'version', v_active_version
    ),
    jsonb_build_object(
      'revision_id', v_new_revision_id,
      'version', v_new_version
    )
  );

  return true;
end;
$$;

revoke all on function private.admin_update_email_template_v1(
  text, integer, text, text, text, text, text
)
from public, anon, authenticated, service_role;
grant execute on function private.admin_update_email_template_v1(
  text, integer, text, text, text, text, text
)
to authenticated;

create or replace function public.admin_update_email_template(
  p_template_key text,
  p_expected_version integer,
  p_subject_template text,
  p_preview_template text,
  p_heading_template text,
  p_body_template text,
  p_button_label text
)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  select private.admin_update_email_template_v1(
    p_template_key,
    p_expected_version,
    p_subject_template,
    p_preview_template,
    p_heading_template,
    p_body_template,
    p_button_label
  );
$$;

revoke all on function public.admin_update_email_template(
  text, integer, text, text, text, text, text
)
from public, anon, authenticated, service_role;
grant execute on function public.admin_update_email_template(
  text, integer, text, text, text, text, text
)
to authenticated;

create or replace function private.admin_reset_email_template_v1(
  p_template_key text,
  p_expected_version integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_active_revision_id uuid;
  v_active_version integer;
  v_default_revision_id uuid;
  v_default_version integer;
  v_default_subject text;
  v_default_preview text;
  v_default_heading text;
  v_default_body text;
  v_default_button text;
  v_new_revision_id uuid;
  v_new_version integer;
begin
  if v_actor is null
     or coalesce(auth.jwt()->'app_metadata'->>'role', '')
       not in ('admin', 'super_admin') then
    raise exception 'Administrator access required'
      using errcode = '42501';
  end if;

  select t.active_version_id, v.version_number
  into v_active_revision_id, v_active_version
  from private.email_templates t
  join private.email_template_versions v
    on v.id = t.active_version_id
   and v.template_key = t.template_key
  where t.template_key = p_template_key
  for update of t;

  if not found then
    raise exception 'Email template not found';
  end if;

  if p_expected_version is null or p_expected_version <> v_active_version then
    return false;
  end if;

  select
    v.id,
    v.version_number,
    v.subject_template,
    v.preview_template,
    v.heading_template,
    v.body_template,
    v.button_label
  into
    v_default_revision_id,
    v_default_version,
    v_default_subject,
    v_default_preview,
    v_default_heading,
    v_default_body,
    v_default_button
  from private.email_template_versions v
  where v.template_key = p_template_key
    and v.is_default;

  if not found then
    raise exception 'Default email template revision not found';
  end if;

  select coalesce(max(v.version_number), 0) + 1
  into v_new_version
  from private.email_template_versions v
  where v.template_key = p_template_key;

  -- Reset is also a new immutable revision. Re-pointing to version 1 would
  -- allow an ABA optimistic-lock race after a template had previously changed.
  insert into private.email_template_versions (
    template_key,
    version_number,
    subject_template,
    preview_template,
    heading_template,
    body_template,
    button_label,
    is_default,
    created_by
  ) values (
    p_template_key,
    v_new_version,
    v_default_subject,
    v_default_preview,
    v_default_heading,
    v_default_body,
    v_default_button,
    false,
    v_actor
  )
  returning id into v_new_revision_id;

  update private.email_templates t
  set active_version_id = v_new_revision_id,
      updated_by = v_actor,
      updated_at = now()
  where t.template_key = p_template_key;

  insert into public.audit_log (
    actor_id,
    entity_type,
    entity_id,
    action,
    old_values,
    new_values
  ) values (
    v_actor,
    'email_template',
    p_template_key,
    'email_template_reset',
    jsonb_build_object(
      'revision_id', v_active_revision_id,
      'version', v_active_version
    ),
    jsonb_build_object(
      'revision_id', v_new_revision_id,
      'version', v_new_version,
      'copied_from_default_revision_id', v_default_revision_id,
      'copied_from_default_version', v_default_version
    )
  );

  return true;
end;
$$;

revoke all on function private.admin_reset_email_template_v1(text, integer)
from public, anon, authenticated, service_role;
grant execute on function private.admin_reset_email_template_v1(text, integer)
to authenticated;

create or replace function public.admin_reset_email_template(
  p_template_key text,
  p_expected_version integer
)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  select private.admin_reset_email_template_v1(
    p_template_key,
    p_expected_version
  );
$$;

revoke all on function public.admin_reset_email_template(text, integer)
from public, anon, authenticated, service_role;
grant execute on function public.admin_reset_email_template(text, integer)
to authenticated;

-- The tables remain private and policy-free. Authenticated administrators and
-- the service-role worker can only reach them through the checked RPCs above.
grant usage on schema private to authenticated, service_role;
