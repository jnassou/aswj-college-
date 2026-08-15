-- Transactional operational email delivery.
--
-- Business workflows continue to write their existing Portal notifications.
-- These triggers only persist a private outbox record; they never contact the
-- provider, so registration and administrator decisions remain independent of
-- Resend availability.

create schema if not exists private;
grant usage on schema private to authenticated, service_role;

create table private.email_deliveries (
  id uuid primary key default gen_random_uuid(),
  source_kind text not null
    check (source_kind in ('application', 'notification')),
  source_id uuid not null,
  notification_id uuid references public.notifications(id) on delete restrict,
  application_id uuid references public.applications(id) on delete restrict,
  enrolment_id uuid references public.enrolments(id) on delete restrict,
  student_id uuid not null references public.profiles(id) on delete restrict,
  template_key text not null check (
    template_key in (
      'application_received',
      'application_accepted',
      'application_waitlisted',
      'application_declined',
      'enrolment_suspended',
      'enrolment_reinstated'
    )
  ),
  template_version text,
  recipient_email text,
  template_payload jsonb not null default '{}'::jsonb,
  email_subject text,
  html_body text,
  text_body text,
  dispatch_status text not null default 'queued' check (
    dispatch_status in (
      'queued',
      'processing',
      'retry_scheduled',
      'submitted',
      'blocked',
      'failed'
    )
  ),
  provider_status text check (
    provider_status is null or provider_status in (
      'sent',
      'delivered',
      'delivery_delayed',
      'bounced',
      'complained',
      'suppressed',
      'failed'
    )
  ),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  attempt_cycle_count integer not null default 0
    check (attempt_cycle_count >= 0),
  next_attempt_at timestamptz not null default now(),
  lease_worker_id uuid,
  lease_expires_at timestamptz,
  provider_submission_started_at timestamptz,
  provider_email_id text,
  provider_event_at timestamptz,
  last_error_code text,
  last_error_message text,
  queued_at timestamptz not null default now(),
  first_attempt_at timestamptz,
  last_attempt_at timestamptz,
  submitted_at timestamptz,
  expires_at timestamptz not null default (now() + interval '7 days'),
  updated_at timestamptz not null default now(),
  constraint email_deliveries_source_unique
    unique (source_kind, source_id, template_key),
  constraint email_deliveries_provider_email_unique
    unique (provider_email_id),
  constraint email_deliveries_rendered_all_or_none check (
    num_nonnulls(template_version, email_subject, html_body, text_body) in (0, 4)
  ),
  constraint email_deliveries_lease_pair check (
    (lease_worker_id is null) = (lease_expires_at is null)
  ),
  constraint email_deliveries_recipient_length check (
    recipient_email is null or char_length(recipient_email) between 3 and 320
  ),
  constraint email_deliveries_error_code_length check (
    last_error_code is null or char_length(last_error_code) <= 120
  ),
  constraint email_deliveries_error_message_length check (
    last_error_message is null or char_length(last_error_message) <= 300
  )
);

comment on table private.email_deliveries is
  'Private transactional outbox for operational student emails. No health, guardian, registration-answer, administrator-note, or suspension-reason content is stored here.';

create index email_deliveries_due_idx
on private.email_deliveries (next_attempt_at, queued_at)
where dispatch_status in ('queued', 'retry_scheduled', 'processing');

create index email_deliveries_admin_status_idx
on private.email_deliveries (dispatch_status, updated_at desc);

create index email_deliveries_student_idx
on private.email_deliveries (student_id, queued_at desc);

create table private.email_provider_events (
  svix_id text primary key,
  delivery_id uuid references private.email_deliveries(id) on delete restrict,
  provider_email_id text not null,
  event_type text not null check (
    event_type in (
      'email.sent',
      'email.delivered',
      'email.delivery_delayed',
      'email.bounced',
      'email.complained',
      'email.suppressed',
      'email.failed'
    )
  ),
  event_created_at timestamptz not null,
  safe_details jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  constraint email_provider_events_svix_id_length
    check (char_length(svix_id) between 1 and 200),
  constraint email_provider_events_provider_id_length
    check (char_length(provider_email_id) between 1 and 200),
  constraint email_provider_events_safe_details_size
    check (octet_length(safe_details::text) <= 1000)
);

comment on table private.email_provider_events is
  'Minimal idempotent Resend event receipts. Full webhook payloads and recipient data are intentionally not retained.';

create index email_provider_events_delivery_idx
on private.email_provider_events (delivery_id, event_created_at desc);

alter table private.email_deliveries enable row level security;
alter table private.email_provider_events enable row level security;

revoke all on table private.email_deliveries
from public, anon, authenticated, service_role;
revoke all on table private.email_provider_events
from public, anon, authenticated, service_role;

grant select, insert, update on table private.email_deliveries to service_role;
grant select, insert, update on table private.email_provider_events to service_role;
-- The service-role worker uses these two current-state reads to suppress an
-- obsolete queued message immediately before claiming it.
grant select on table public.applications, public.enrolments to service_role;

-- Future notification channels must not become student-readable by accident.
drop policy if exists notifications_owner_or_admin_select
on public.notifications;
drop policy if exists notifications_select_own_or_admin
on public.notifications;
create policy notifications_owner_or_admin_select
on public.notifications
for select
to authenticated
using (
  (
    student_id = (select auth.uid())
    and channel = 'portal'
  )
  or coalesce(
    (select auth.jwt()->'app_metadata'->>'role'),
    ''
  ) in ('admin', 'super_admin')
);

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
begin
  if p_source_kind not in ('application', 'notification')
     or p_source_id is null
     or p_student_id is null
     or p_template_key not in (
       'application_received',
       'application_accepted',
       'application_waitlisted',
       'application_declined',
       'enrolment_suspended',
       'enrolment_reinstated'
     ) then
    raise exception 'Invalid email outbox source';
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

create or replace function private.enqueue_application_received_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.enqueue_email_delivery_v1(
    'application',
    new.id,
    'application_received',
    new.student_id,
    null,
    new.id,
    null
  );
  return null;
end;
$$;

revoke all on function private.enqueue_application_received_email()
from public, anon, authenticated, service_role;

drop trigger if exists applications_queue_received_email
on public.applications;
create trigger applications_queue_received_email
after insert on public.applications
for each row execute function private.enqueue_application_received_email();

create or replace function private.enqueue_portal_notification_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.channel <> 'portal'
     or new.template_key not in (
       'application_accepted',
       'application_waitlisted',
       'application_declined',
       'enrolment_suspended',
       'enrolment_reinstated'
     ) then
    return null;
  end if;

  perform private.enqueue_email_delivery_v1(
    'notification',
    new.id,
    new.template_key,
    new.student_id,
    new.id,
    new.application_id,
    new.enrolment_id
  );
  return null;
end;
$$;

revoke all on function private.enqueue_portal_notification_email()
from public, anon, authenticated, service_role;

drop trigger if exists notifications_queue_operational_email
on public.notifications;
create trigger notifications_queue_operational_email
after insert on public.notifications
for each row execute function private.enqueue_portal_notification_email();

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

  -- Expired content is held for review instead of being sent unexpectedly.
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
      or (
        d.dispatch_status = 'processing'
        and d.lease_expires_at <= now()
      )
    );

  -- Once a provider request may have started, retries use the same idempotency
  -- key only within a conservative 23-hour protection window. An expired lease
  -- outside that window is ambiguous and must never be replayed automatically.
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
      or (
        d.dispatch_status = 'processing'
        and d.lease_expires_at <= now()
      )
    );

  -- Recover a worker lease only after it has actually expired. Seven claimed
  -- attempts is the hard automatic limit; administrators can explicitly
  -- requeue eligible failures without erasing the attempt history.
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

  -- Do not send a status message that became obsolete while it waited in the
  -- queue. Lease recovery runs first so a crashed stale attempt is checked too.
  -- The candidate statement below repeats the positive current-state check to
  -- close the commit window between this maintenance update and row claiming.
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
        (
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

create or replace function public.prepare_email_delivery(
  p_delivery_id uuid,
  p_worker_id uuid,
  p_template_version text,
  p_subject text,
  p_html text,
  p_text text
)
returns table (
  delivery_id uuid,
  template_version text,
  email_subject text,
  html_body text,
  text_body text
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_delivery_id is null or p_worker_id is null
     or nullif(btrim(p_template_version), '') is null
     or char_length(p_template_version) > 50
     or nullif(btrim(p_subject), '') is null
     or char_length(p_subject) > 500
     or p_subject ~ '[[:cntrl:]]'
     or nullif(p_html, '') is null
     or octet_length(p_html) > 200000
     or nullif(p_text, '') is null
     or octet_length(p_text) > 50000 then
    raise exception 'Invalid rendered email';
  end if;

  update private.email_deliveries d
  set template_version = case
        when d.template_version is null then btrim(p_template_version)
        else d.template_version
      end,
      email_subject = case
        when d.email_subject is null then p_subject
        else d.email_subject
      end,
      html_body = case when d.html_body is null then p_html else d.html_body end,
      text_body = case when d.text_body is null then p_text else d.text_body end,
      updated_at = now()
  where d.id = p_delivery_id
    and d.dispatch_status = 'processing'
    and d.lease_worker_id = p_worker_id
    and d.lease_expires_at > now();

  if not found then
    raise exception 'Email delivery lease is not current'
      using errcode = '40001';
  end if;

  return query
  select
    d.id,
    d.template_version,
    d.email_subject,
    d.html_body,
    d.text_body
  from private.email_deliveries d
  where d.id = p_delivery_id;
end;
$$;

revoke all on function public.prepare_email_delivery(
  uuid, uuid, text, text, text, text
)
from public, anon, authenticated, service_role;
grant execute on function public.prepare_email_delivery(
  uuid, uuid, text, text, text, text
)
to service_role;

create or replace function public.mark_email_submission_started(
  p_delivery_id uuid,
  p_worker_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_delivery_id is null or p_worker_id is null then
    raise exception 'Invalid email submission marker';
  end if;

  update private.email_deliveries d
  set provider_submission_started_at = coalesce(
        d.provider_submission_started_at,
        now()
      ),
      updated_at = now()
  where d.id = p_delivery_id
    and d.dispatch_status = 'processing'
    and d.lease_worker_id = p_worker_id
    and d.lease_expires_at > now()
    and d.template_version is not null
    and d.email_subject is not null
    and d.html_body is not null
    and d.text_body is not null
    and (
      d.provider_submission_started_at is null
      or d.provider_submission_started_at > now() - interval '23 hours'
    );

  if not found then
    raise exception 'Email delivery is outside its safe submission window'
      using errcode = '40001';
  end if;

  return true;
end;
$$;

revoke all on function public.mark_email_submission_started(uuid, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.mark_email_submission_started(uuid, uuid)
to service_role;

create or replace function public.record_email_submitted(
  p_delivery_id uuid,
  p_worker_id uuid,
  p_provider_email_id text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_provider_status text;
  v_provider_event_at timestamptz;
  v_provider_details jsonb;
begin
  if p_delivery_id is null or p_worker_id is null
     or nullif(btrim(p_provider_email_id), '') is null
     or char_length(p_provider_email_id) > 200
     or p_provider_email_id ~ '[[:cntrl:]]' then
    raise exception 'Invalid submitted email result';
  end if;

  -- Serialize the provider response and a possibly faster signed webhook by the
  -- normalized provider identifier. Whichever transaction wins the lock leaves
  -- enough committed state for the second transaction to link and project.
  perform pg_advisory_xact_lock(
    hashtextextended(btrim(p_provider_email_id), 0)
  );

  update private.email_deliveries d
  set dispatch_status = 'submitted',
      provider_email_id = btrim(p_provider_email_id),
      submitted_at = coalesce(d.submitted_at, now()),
      lease_worker_id = null,
      lease_expires_at = null,
      last_error_code = null,
      last_error_message = null,
      updated_at = now()
  where d.id = p_delivery_id
    and d.dispatch_status = 'processing'
    and d.lease_worker_id = p_worker_id
    and d.lease_expires_at > now()
    and d.provider_submission_started_at is not null
    and d.template_version is not null
    and d.email_subject is not null
    and d.html_body is not null
    and d.text_body is not null;

  if not found then
    raise exception 'Email delivery lease is not current'
      using errcode = '40001';
  end if;

  -- A signed provider webhook can arrive before the send response is persisted.
  -- Link any such event now, then apply the newest projection without replaying it.
  update private.email_provider_events e
  set delivery_id = p_delivery_id
  where e.provider_email_id = btrim(p_provider_email_id)
    and e.delivery_id is null;

  select
    substring(e.event_type from 7),
    e.event_created_at,
    e.safe_details
  into v_provider_status, v_provider_event_at, v_provider_details
  from private.email_provider_events e
  where e.provider_email_id = btrim(p_provider_email_id)
  order by e.event_created_at desc, e.received_at desc, e.svix_id desc
  limit 1;

  if found then
    update private.email_deliveries d
    set provider_status = v_provider_status,
        provider_event_at = v_provider_event_at,
        last_error_code = case
          when v_provider_status in ('bounced', 'complained', 'suppressed', 'failed')
            then 'provider_' || v_provider_status
          else d.last_error_code
        end,
        last_error_message = case
          when v_provider_status = 'bounced'
            then 'The receiving server rejected this email.'
          when v_provider_status = 'complained'
            then 'The recipient marked this email as spam.'
          when v_provider_status = 'suppressed'
            then 'The provider suppressed this recipient.'
          when v_provider_status = 'failed'
            and coalesce(v_provider_details->>'reason', '')
              ~ '^[a-zA-Z0-9_.:-]{1,80}$'
            then 'The provider reported a delivery failure ('
              || (v_provider_details->>'reason') || ').'
          when v_provider_status = 'failed'
            then 'The provider reported a delivery failure.'
          else d.last_error_message
        end,
        updated_at = now()
    where d.id = p_delivery_id
      and v_provider_event_at >= coalesce(
        d.provider_event_at,
        '-infinity'::timestamptz
      );
  end if;

  return true;
end;
$$;

revoke all on function public.record_email_submitted(uuid, uuid, text)
from public, anon, authenticated, service_role;
grant execute on function public.record_email_submitted(uuid, uuid, text)
to service_role;

create or replace function public.record_email_retry(
  p_delivery_id uuid,
  p_worker_id uuid,
  p_error_code text,
  p_error_message text,
  p_next_attempt_at timestamptz
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_delivery_id is null or p_worker_id is null
     or p_error_code !~ '^[a-zA-Z0-9_.:-]{1,120}$'
     or nullif(btrim(p_error_message), '') is null
     or char_length(p_error_message) > 300
     or p_error_message ~ '[[:cntrl:]]'
     or p_next_attempt_at is null
     or p_next_attempt_at <= now()
     or p_next_attempt_at > now() + interval '2 days' then
    raise exception 'Invalid email retry result';
  end if;

  update private.email_deliveries d
  set dispatch_status = case
        when d.attempt_cycle_count >= 7 then 'failed'
        else 'retry_scheduled'
      end,
      next_attempt_at = p_next_attempt_at,
      lease_worker_id = null,
      lease_expires_at = null,
      last_error_code = p_error_code,
      last_error_message = btrim(p_error_message),
      updated_at = now()
  where d.id = p_delivery_id
    and d.dispatch_status = 'processing'
    and d.lease_worker_id = p_worker_id
    and d.lease_expires_at > now();

  if not found then
    raise exception 'Email delivery lease is not current'
      using errcode = '40001';
  end if;

  return true;
end;
$$;

revoke all on function public.record_email_retry(
  uuid, uuid, text, text, timestamptz
)
from public, anon, authenticated, service_role;
grant execute on function public.record_email_retry(
  uuid, uuid, text, text, timestamptz
)
to service_role;

create or replace function public.record_email_failed(
  p_delivery_id uuid,
  p_worker_id uuid,
  p_error_code text,
  p_error_message text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_delivery_id is null or p_worker_id is null
     or p_error_code !~ '^[a-zA-Z0-9_.:-]{1,120}$'
     or nullif(btrim(p_error_message), '') is null
     or char_length(p_error_message) > 300
     or p_error_message ~ '[[:cntrl:]]' then
    raise exception 'Invalid email failure result';
  end if;

  update private.email_deliveries d
  set dispatch_status = 'failed',
      lease_worker_id = null,
      lease_expires_at = null,
      last_error_code = p_error_code,
      last_error_message = btrim(p_error_message),
      updated_at = now()
  where d.id = p_delivery_id
    and d.dispatch_status = 'processing'
    and d.lease_worker_id = p_worker_id
    and d.lease_expires_at > now();

  if not found then
    raise exception 'Email delivery lease is not current'
      using errcode = '40001';
  end if;

  return true;
end;
$$;

revoke all on function public.record_email_failed(uuid, uuid, text, text)
from public, anon, authenticated, service_role;
grant execute on function public.record_email_failed(uuid, uuid, text, text)
to service_role;

create or replace function public.record_resend_webhook_event(
  p_svix_id text,
  p_provider_email_id text,
  p_event_type text,
  p_event_created_at timestamptz,
  p_details jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_delivery_id uuid;
  v_provider_status text;
begin
  if nullif(btrim(p_svix_id), '') is null
     or char_length(p_svix_id) > 200
     or p_svix_id ~ '[[:cntrl:]]'
     or nullif(btrim(p_provider_email_id), '') is null
     or char_length(p_provider_email_id) > 200
     or p_provider_email_id ~ '[[:cntrl:]]'
     or p_event_type not in (
       'email.sent',
       'email.delivered',
       'email.delivery_delayed',
       'email.bounced',
       'email.complained',
       'email.suppressed',
       'email.failed'
     )
     or p_event_created_at is null
     or p_event_created_at > now() + interval '10 minutes'
     or p_details is null
     or jsonb_typeof(p_details) <> 'object'
     or octet_length(p_details::text) > 1000 then
    raise exception 'Invalid email provider event';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(btrim(p_provider_email_id), 0)
  );

  select d.id
  into v_delivery_id
  from private.email_deliveries d
  where d.provider_email_id = btrim(p_provider_email_id);

  insert into private.email_provider_events (
    svix_id,
    delivery_id,
    provider_email_id,
    event_type,
    event_created_at,
    safe_details
  ) values (
    btrim(p_svix_id),
    v_delivery_id,
    btrim(p_provider_email_id),
    p_event_type,
    p_event_created_at,
    p_details
  )
  on conflict (svix_id) do nothing;

  if not found then
    return false;
  end if;

  if v_delivery_id is null then
    return true;
  end if;

  v_provider_status := substring(p_event_type from 7);

  update private.email_deliveries d
  set provider_status = v_provider_status,
      provider_event_at = p_event_created_at,
      last_error_code = case
        when v_provider_status in ('bounced', 'complained', 'suppressed', 'failed')
          then 'provider_' || v_provider_status
        else d.last_error_code
      end,
      last_error_message = case
        when v_provider_status = 'bounced' then 'The receiving server rejected this email.'
        when v_provider_status = 'complained' then 'The recipient marked this email as spam.'
        when v_provider_status = 'suppressed' then 'The provider suppressed this recipient.'
        when v_provider_status = 'failed'
          and coalesce(p_details->>'reason', '')
            ~ '^[a-zA-Z0-9_.:-]{1,80}$'
          then 'The provider reported a delivery failure ('
            || (p_details->>'reason') || ').'
        when v_provider_status = 'failed' then 'The provider reported a delivery failure.'
        else d.last_error_message
      end,
      updated_at = now()
  where d.id = v_delivery_id
    and p_event_created_at >= coalesce(
      d.provider_event_at,
      '-infinity'::timestamptz
    );

  return true;
end;
$$;

revoke all on function public.record_resend_webhook_event(
  text, text, text, timestamptz, jsonb
)
from public, anon, authenticated, service_role;
grant execute on function public.record_resend_webhook_event(
  text, text, text, timestamptz, jsonb
)
to service_role;

create or replace function private.admin_list_email_deliveries_v1(
  p_limit integer default 250
)
returns table (
  delivery_id uuid,
  student_name text,
  event_label text,
  template_key text,
  class_name text,
  class_term text,
  class_label text,
  dispatch_status text,
  provider_status text,
  attempt_count integer,
  retry_allowed boolean,
  queued_at timestamptz,
  next_attempt_at timestamptz,
  submitted_at timestamptz,
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
    d.id,
    coalesce(
      nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
      'Student'
    ),
    case d.template_key
      when 'application_received' then 'Application received'
      when 'application_accepted' then 'Application accepted'
      when 'application_waitlisted' then 'Application waitlisted'
      when 'application_declined' then 'Application update'
      when 'enrolment_suspended' then 'Enrolment suspended'
      when 'enrolment_reinstated' then 'Enrolment reinstated'
      else 'College update'
    end,
    d.template_key,
    d.template_payload->>'class_name',
    d.template_payload->>'class_term',
    concat_ws(
      ' — ',
      nullif(d.template_payload->>'class_name', ''),
      nullif(d.template_payload->>'class_term', '')
    ),
    d.dispatch_status,
    d.provider_status,
    d.attempt_count,
    (
      d.dispatch_status in ('failed', 'blocked')
      and d.provider_email_id is null
      and d.provider_status is null
      and d.recipient_email is not null
      and (
        d.provider_submission_started_at is null
        or d.provider_submission_started_at > now() - interval '23 hours'
      )
      and coalesce(d.last_error_code, '') not in (
        'idempotency_window_expired',
        'invalid_recipient',
        'recipient_missing',
        'superseded',
        'unsupported_template'
      )
    ),
    d.queued_at,
    d.next_attempt_at,
    d.submitted_at,
    d.updated_at
  from private.email_deliveries d
  join public.profiles p on p.id = d.student_id
  order by
    case
      when d.dispatch_status in ('failed', 'blocked')
        or d.provider_status in ('bounced', 'complained', 'suppressed', 'failed')
        then 0
      when d.dispatch_status in ('queued', 'retry_scheduled') then 1
      when d.dispatch_status = 'processing' then 2
      else 3
    end,
    d.updated_at desc,
    d.id
  limit least(greatest(coalesce(p_limit, 250), 1), 500);
end;
$$;

revoke all on function private.admin_list_email_deliveries_v1(integer)
from public, anon, authenticated, service_role;
grant execute on function private.admin_list_email_deliveries_v1(integer)
to authenticated;

create or replace function public.admin_list_email_deliveries(
  p_limit integer default 250
)
returns table (
  delivery_id uuid,
  student_name text,
  event_label text,
  template_key text,
  class_name text,
  class_term text,
  class_label text,
  dispatch_status text,
  provider_status text,
  attempt_count integer,
  retry_allowed boolean,
  queued_at timestamptz,
  next_attempt_at timestamptz,
  submitted_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select *
  from private.admin_list_email_deliveries_v1(p_limit);
$$;

revoke all on function public.admin_list_email_deliveries(integer)
from public, anon, authenticated, service_role;
grant execute on function public.admin_list_email_deliveries(integer)
to authenticated;

create or replace function private.admin_get_email_delivery_v1(
  p_delivery_id uuid
)
returns table (
  delivery_id uuid,
  student_name text,
  event_label text,
  template_key text,
  class_name text,
  class_term text,
  class_label text,
  recipient_email text,
  dispatch_status text,
  provider_status text,
  attempt_count integer,
  retry_allowed boolean,
  queued_at timestamptz,
  last_attempt_at timestamptz,
  next_attempt_at timestamptz,
  sent_at timestamptz,
  provider_message_id text,
  last_error_code text,
  last_error_message text
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

  if p_delivery_id is null then
    raise exception 'Email delivery not found';
  end if;

  return query
  select
    d.id,
    coalesce(
      nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
      'Student'
    ),
    case d.template_key
      when 'application_received' then 'Application received'
      when 'application_accepted' then 'Application accepted'
      when 'application_waitlisted' then 'Application waitlisted'
      when 'application_declined' then 'Application update'
      when 'enrolment_suspended' then 'Enrolment suspended'
      when 'enrolment_reinstated' then 'Enrolment reinstated'
      else 'College update'
    end,
    d.template_key,
    d.template_payload->>'class_name',
    d.template_payload->>'class_term',
    concat_ws(
      ' — ',
      nullif(d.template_payload->>'class_name', ''),
      nullif(d.template_payload->>'class_term', '')
    ),
    d.recipient_email,
    d.dispatch_status,
    d.provider_status,
    d.attempt_count,
    (
      d.dispatch_status in ('failed', 'blocked')
      and d.provider_email_id is null
      and d.provider_status is null
      and d.recipient_email is not null
      and (
        d.provider_submission_started_at is null
        or d.provider_submission_started_at > now() - interval '23 hours'
      )
      and coalesce(d.last_error_code, '') not in (
        'idempotency_window_expired',
        'invalid_recipient',
        'recipient_missing',
        'superseded',
        'unsupported_template'
      )
    ),
    d.queued_at,
    d.last_attempt_at,
    d.next_attempt_at,
    d.submitted_at,
    d.provider_email_id,
    d.last_error_code,
    d.last_error_message
  from private.email_deliveries d
  join public.profiles p on p.id = d.student_id
  where d.id = p_delivery_id;
end;
$$;

revoke all on function private.admin_get_email_delivery_v1(uuid)
from public, anon, authenticated, service_role;
grant execute on function private.admin_get_email_delivery_v1(uuid)
to authenticated;

create or replace function public.admin_get_email_delivery(
  p_delivery_id uuid
)
returns table (
  delivery_id uuid,
  student_name text,
  event_label text,
  template_key text,
  class_name text,
  class_term text,
  class_label text,
  recipient_email text,
  dispatch_status text,
  provider_status text,
  attempt_count integer,
  retry_allowed boolean,
  queued_at timestamptz,
  last_attempt_at timestamptz,
  next_attempt_at timestamptz,
  sent_at timestamptz,
  provider_message_id text,
  last_error_code text,
  last_error_message text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select *
  from private.admin_get_email_delivery_v1(p_delivery_id);
$$;

revoke all on function public.admin_get_email_delivery(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.admin_get_email_delivery(uuid)
to authenticated;

create or replace function private.admin_retry_email_delivery_v1(
  p_delivery_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_delivery private.email_deliveries%rowtype;
begin
  if v_actor is null
     or coalesce(auth.jwt()->'app_metadata'->>'role', '')
       not in ('admin', 'super_admin') then
    raise exception 'Administrator access required'
      using errcode = '42501';
  end if;

  select d.*
  into v_delivery
  from private.email_deliveries d
  where d.id = p_delivery_id
  for update;

  if not found then
    raise exception 'Email delivery not found';
  end if;

  if v_delivery.dispatch_status not in ('failed', 'blocked')
     or v_delivery.provider_email_id is not null
     or v_delivery.provider_status is not null
     or v_delivery.recipient_email is null
     or (
       v_delivery.provider_submission_started_at is not null
       and v_delivery.provider_submission_started_at <= now() - interval '23 hours'
     )
     or coalesce(v_delivery.last_error_code, '') in (
       'idempotency_window_expired',
       'invalid_recipient',
       'recipient_missing',
       'superseded',
       'unsupported_template'
     ) then
    return false;
  end if;

  update private.email_deliveries d
  set dispatch_status = 'queued',
      attempt_cycle_count = 0,
      next_attempt_at = now(),
      lease_worker_id = null,
      lease_expires_at = null,
      last_error_code = null,
      last_error_message = null,
      expires_at = now() + interval '7 days',
      updated_at = now()
  where d.id = p_delivery_id;

  insert into public.audit_log (
    actor_id,
    entity_type,
    entity_id,
    action,
    old_values,
    new_values
  ) values (
    v_actor,
    'email_delivery',
    p_delivery_id::text,
    'email_delivery_requeued',
    jsonb_build_object(
      'dispatch_status', v_delivery.dispatch_status,
      'attempt_count', v_delivery.attempt_count,
      'last_error_code', v_delivery.last_error_code
    ),
    jsonb_build_object(
      'dispatch_status', 'queued',
      'attempt_count', v_delivery.attempt_count,
      'requeued_at', now()
    )
  );

  return true;
end;
$$;

revoke all on function private.admin_retry_email_delivery_v1(uuid)
from public, anon, authenticated, service_role;
grant execute on function private.admin_retry_email_delivery_v1(uuid)
to authenticated;

create or replace function public.admin_retry_email_delivery(
  p_delivery_id uuid
)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  select private.admin_retry_email_delivery_v1(p_delivery_id);
$$;

revoke all on function public.admin_retry_email_delivery(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.admin_retry_email_delivery(uuid)
to authenticated;

-- Triggers and helper functions are internal-only. Public worker functions are
-- service-role-only, while administrator read/requeue functions authenticate
-- the signed-in administrator inside the database.
alter default privileges in schema public
revoke execute on functions from public;
alter default privileges in schema private
revoke execute on functions from public;
