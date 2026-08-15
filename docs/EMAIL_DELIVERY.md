# Transactional email delivery

ASWJ College sends operational student messages through a database-backed
outbox and Resend. Application and enrolment changes enqueue an immutable
delivery record. A small authenticated worker claims records, freezes the
rendered subject/HTML/text, and submits them sequentially.

Email delivery is optional and fail-closed. If `EMAIL_DELIVERY_ENABLED` is not
exactly `true`, or any required setting is absent or invalid, the worker returns
without claiming queue records. The Student Portal and Admin workflows continue
to operate without an email provider. Preview deployments never submit email,
even if the enable flag is accidentally shared with them.

## Server-only environment variables

Configure these in the Vercel project for Production. Do not expose any of them
to browser code and do not add `NEXT_PUBLIC_` to their names.

| Variable | Purpose |
| --- | --- |
| `EMAIL_DELIVERY_ENABLED` | Exact value `true` enables delivery after all setup is complete. |
| `RESEND_API_KEY` | Resend key with sending access; use the least privilege available. |
| `RESEND_WEBHOOK_SECRET` | Signing secret for the production webhook endpoint. |
| `CRON_SECRET` | Random secret of at least 32 characters used as the worker endpoint Bearer token. |
| `EMAIL_FROM` | Sender on the verified domain, for example `ASWJ College <no-reply@example.org>`. |
| `EMAIL_REPLY_TO` | Monitored administration address on a safe email header. |
| `EMAIL_APP_BASE_URL` | Canonical HTTPS production origin; links resolve to `/student`. |
| `SUPABASE_SERVICE_ROLE_KEY` | Existing server-only key used only by privileged queue RPCs. |

The existing `NEXT_PUBLIC_SUPABASE_URL` is also required to locate the project.
Although that URL is public by design, the service-role key must remain secret.

## Resend setup

1. Add the sending domain in Resend and publish the exact DNS records Resend
   provides. Wait until Resend reports the domain as verified.
2. Choose `EMAIL_FROM` on that verified domain. Use a monitored address for
   `EMAIL_REPLY_TO`.
3. Create a production API key and store it as `RESEND_API_KEY` in Vercel.
4. Create a Resend webhook pointing to:

   `https://YOUR_PRODUCTION_DOMAIN/api/webhooks/resend`

5. Subscribe it to `email.sent`, `email.delivered`,
   `email.delivery_delayed`, `email.bounced`, `email.complained`,
   `email.suppressed`, and `email.failed`.
6. Copy that endpoint's signing secret to `RESEND_WEBHOOK_SECRET`. Do not use a
   secret from a different webhook or environment.

The handler verifies the signature against the unmodified raw request body
before it reads event fields. Duplicate webhook IDs are acknowledged with HTTP
200, so provider retries do not apply the same status twice. Signed status
callbacks remain enabled while outbound delivery is paused; this preserves late
delivery, bounce, complaint and suppression updates for messages already sent.

Resend references:

- [Domain verification](https://resend.com/docs/dashboard/domains/introduction)
- [Webhook signature verification](https://resend.com/docs/webhooks/verify-webhooks-requests)
- [Idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys)

## Scheduler setup

The worker endpoint is:

`GET /api/cron/email-delivery`

It requires `Authorization: Bearer <CRON_SECRET>`. The route rejects missing or
invalid authorization, checks the complete email configuration before claiming
anything, and processes a fixed batch of five records. Vercel Cron automatically
sends this header when the project has a `CRON_SECRET` environment variable.

No schedule is committed in this repository because the allowed frequency
depends on the Vercel plan. After confirming the production plan, choose one of
these options:

- Add a plan-compatible Vercel Cron schedule for
  `/api/cron/email-delivery`, then deploy that schedule with the application.
- Use a trusted external scheduler that can make an HTTPS GET request with the
  same Bearer token.

For timely application updates, a short interval such as every five minutes is
appropriate when the selected plan supports it. Never put `CRON_SECRET` in a URL
or query string.

Vercel references:

- [Cron job configuration](https://vercel.com/docs/cron-jobs)
- [Securing cron jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs)
- [Cron usage and plan limits](https://vercel.com/docs/cron-jobs/usage-and-pricing)

## Delivery guarantees and failure behavior

- Every provider request uses the stable idempotency key
  `aswj-email/<delivery UUID>`. A worker crash after provider acceptance can be
  retried without intentionally producing a second email.
- The queue records when a provider request may have started. Automatic and
  administrator retries reuse the same key only inside a conservative 23-hour
  safety window; an unresolved attempt is blocked before Resend's 24-hour
  idempotency retention can expire. Provider-recorded failures, bounces,
  complaints and suppressions are retained for review and are not replayed.
- Rendered subject, HTML and plain text are frozen before the first send. Later
  template edits therefore cannot change a retry that uses the same idempotency
  key.
- Temporary provider failures retry with bounded backoff. A delivery is marked
  failed after seven claimed attempts. Permanent configuration, validation, or
  recipient failures do not loop indefinitely.
- A queued delivery that has not been submitted within its approved seven-day
  window is held for administrator review instead of being sent unexpectedly.
- Queue processing is sequential and batch-limited to reduce provider bursts.
- Logs and stored worker errors use sanitized categories. They do not include
  recipient addresses, message bodies, provider payloads, secrets, medical
  notes, learning notes, allergy notes, or decision reasons.
- Templates include only the student's first name, class label, optional term,
  optional waiting-list position, and a link to the Student Portal.

## Safe activation order

1. Apply the email-outbox database migration and confirm its RPCs exist.
2. Complete the verified sending domain, API key, and signed webhook setup.
3. Add every environment variable above with
   `EMAIL_DELIVERY_ENABLED=false`, then redeploy.
4. Configure and verify the scheduler authorization.
5. Set `EMAIL_DELIVERY_ENABLED=true` and redeploy.
6. Create a non-sensitive test application/status event, process the queue, and
   confirm both the Admin delivery record and the signed Resend status update.

To stop provider submissions without disrupting registration, set
`EMAIL_DELIVERY_ENABLED=false` and redeploy. Queued records remain unclaimed for
later processing, while the signed webhook continues recording the outcome of
messages that were already submitted.
