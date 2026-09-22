# Transactional email delivery

ASWJ College sends operational student messages through a database-backed
outbox and Resend. Application and enrolment changes enqueue an immutable
delivery record. A small authenticated worker claims records, freezes the
rendered subject/HTML/text, and submits them sequentially.

Email delivery is optional and fail-closed. If `EMAIL_DELIVERY_ENABLED` is not
exactly `true`, or any required setting is absent or invalid, the worker returns
without claiming queue records. The Student Portal and Admin workflows continue
to operate without an email provider. Preview and local runtimes can submit only
when they have a valid `EMAIL_DELIVERY_TEST_RECIPIENT`; every message is forced
to that address and its subject is prefixed with `[DEV]`. Only an explicit
Vercel Production runtime may use the intended student recipient.

The app sends an editable welcome message after Supabase confirms a new account,
as well as application received, accepted, waiting-list, declined, enrolment
suspended and enrolment reinstated messages. The secure email-confirmation link
remains a Supabase Auth message and is intentionally not editable in the app.

## Server-only environment variables

Configure these in the Vercel project for Production. Do not expose any of them
to browser code and do not add `NEXT_PUBLIC_` to their names.

| Variable | Purpose |
| --- | --- |
| `EMAIL_DELIVERY_ENABLED` | Exact value `true` enables delivery after all setup is complete. |
| `EMAIL_DELIVERY_EXPECTED_SUPABASE_PROJECT_REF` | Must match the 20-character project ref in `NEXT_PUBLIC_SUPABASE_URL`; prevents a worker consuming the wrong queue. |
| `EMAIL_DELIVERY_PRODUCTION_SUPABASE_PROJECT_REF` | Required in dev/Preview. Must name Production so dev refuses to run if it is accidentally connected to Production. |
| `RESEND_API_KEY` | Resend key with sending access; use the least privilege available. |
| `RESEND_WEBHOOK_SECRET` | Signing secret for the production webhook endpoint. |
| `CRON_SECRET` | Random secret of at least 32 characters used as the worker endpoint Bearer token. |
| `EMAIL_FROM` | Sender on the verified domain, for example `ASWJ College <no-reply@example.org>`. |
| `EMAIL_REPLY_TO` | Monitored administration address on a safe email header. |
| `EMAIL_APP_BASE_URL` | Required canonical HTTPS origin for signup confirmation returns and Student Portal links; set separately for dev and Production. |
| `SUPABASE_SERVICE_ROLE_KEY` | Existing server-only key used only by privileged queue RPCs. |
| `EMAIL_DELIVERY_TEST_RECIPIENT` | Non-production only. Forces every dev, Preview or local email to one administrator-controlled mailbox. Never set this as a replacement for production recipients. |

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
- Each queue record pins the active template revision when the event happens.
  Administrators edit structured text in **Admin → Email messages**; saves
  create an immutable new revision and affect future queue records only.
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

## Editing messages in the app

Administrators and super administrators can open **Admin → Email messages**.
The editor supports subject, preview text, heading, message and button label,
plus only the safe variables shown for that event. Template text is rendered by
the application and escaped; administrators cannot insert HTML, scripts,
attachments, sender addresses or secrets.

Every save creates a new numbered revision. Existing queued messages retain the
revision selected when they were queued, and messages already prepared for
Resend retain their frozen subject, HTML and text. **Restore default** also
creates a new revision so the history is not destroyed.

The account welcome message is queued once, after `email_confirmed_at` becomes
available. Supabase Auth still owns the preceding confirmation-link email. To
change that secure message, use the Supabase Auth email template settings or a
separately reviewed Send Email Hook; do not copy confirmation tokens into the
ordinary application email queue.

If the first welcome enqueue fails, a private reconciliation marker remains.
The next authorised email-worker run retries it without blocking sign-up or
confirmation. A recovered welcome is held for review rather than sent if its
original confirmation is more than seven days old. Existing accounts are not
bulk-welcomed when the migration is installed.

For confirmation links that work even when the student opens email on another
device, set the Supabase **Confirm signup** email template link to:

`{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email`

The app verifies that one-time token at `/auth/confirm`, establishes the
cookie-based session and opens the Student Portal. The `/auth/callback` route
also supports Supabase's standard same-browser code flow. Set the correct Site
URL for each Supabase project, and add the exact production and development
callback origins to **Supabase Auth → URL Configuration → Redirect URLs**, for
example:

- `https://aswjcollege.com.au/auth/callback`
- the stable development origin followed by `/auth/callback`

Do not use a wildcard production redirect. `EMAIL_APP_BASE_URL` is required
and must point to the same stable origin in each environment so confirmation
returns and Student Portal links do not use an ephemeral deployment hostname.

## Safe dev testing

Keep `EMAIL_DELIVERY_ENABLED=false` in Preview until a controlled recipient is
ready. Dev must use its separate Supabase project. Set
`EMAIL_DELIVERY_EXPECTED_SUPABASE_PROJECT_REF` to the dev project ref,
`EMAIL_DELIVERY_PRODUCTION_SUPABASE_PROJECT_REF` to the different Production
ref, and `EMAIL_DELIVERY_TEST_RECIPIENT` to the tester's mailbox. Only then set
`EMAIL_DELIVERY_ENABLED=true` and redeploy. If the database refs are missing,
mismatched, or equal, the worker will not claim queue records. The dev queue
still records the intended student recipient, but Resend receives only the
forced tester. Remove or disable these Preview settings after testing.

## Safe activation order

1. Apply the email-outbox database migration and confirm its RPCs exist.
2. Complete the verified sending domain, API key, and signed webhook setup.
3. Add every environment variable above with
   `EMAIL_DELIVERY_ENABLED=false`, then redeploy.
4. Configure and verify the scheduler authorization.
5. Set `EMAIL_DELIVERY_ENABLED=true` and redeploy.
6. Create a non-sensitive test account and confirm it, then create an application
   and status event. Process the queue and confirm welcome, receipt, acceptance,
   the Admin delivery records and signed Resend status updates.

To stop provider submissions without disrupting registration, set
`EMAIL_DELIVERY_ENABLED=false` and redeploy. Queued records remain unclaimed for
later processing, while the signed webhook continues recording the outcome of
messages that were already submitted.
