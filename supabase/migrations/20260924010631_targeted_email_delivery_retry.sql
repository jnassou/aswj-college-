-- Claim exactly one administrator-selected email delivery without consuming
-- any other ready queue item. The existing worker owns rendering, provider
-- submission, idempotency, and result recording after this scoped claim.
create or replace function public.claim_email_delivery(
  p_worker_id uuid,
  p_delivery_id uuid,
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
  v_lease_seconds integer;
begin
  if p_worker_id is null then
    raise exception 'Worker identifier is required';
  end if;

  if p_delivery_id is null then
    raise exception 'Delivery identifier is required';
  end if;

  v_lease_seconds := least(greatest(coalesce(p_lease_seconds, 120), 30), 600);

  update private.email_deliveries d
  set dispatch_status = 'blocked',
      lease_worker_id = null,
      lease_expires_at = null,
      last_error_code = 'expired',
      last_error_message = 'This delivery passed its approved seven-day sending window.',
      updated_at = now()
  where d.id = p_delivery_id
    and d.expires_at <= now()
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
  where d.id = p_delivery_id
    and d.provider_email_id is null
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
  where d.id = p_delivery_id
    and d.dispatch_status = 'processing'
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
  where d.id = p_delivery_id
    and d.dispatch_status in ('queued', 'retry_scheduled')
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
  with candidate as (
    select d.id
    from private.email_deliveries d
    where d.id = p_delivery_id
      and d.dispatch_status in ('queued', 'retry_scheduled')
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
    for update skip locked
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
    from candidate c
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

revoke all on function public.claim_email_delivery(uuid, uuid, integer)
from public, anon, authenticated, service_role;
grant execute on function public.claim_email_delivery(uuid, uuid, integer)
to service_role;
