import type { WebhookEventPayload } from 'resend';
import { createSupabaseAdminClient } from '../../../../lib/supabase/admin';
import { getEmailWebhookConfigurationStatus } from '../../../../lib/email/config';
import { createResendWebhookVerifier } from '../../../../lib/email/resend';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_WEBHOOK_BODY_BYTES = 256_000;

const TRACKED_EVENT_TYPES = [
  'email.sent',
  'email.delivered',
  'email.delivery_delayed',
  'email.bounced',
  'email.complained',
  'email.suppressed',
  'email.failed',
] as const;

type TrackedEventType = (typeof TRACKED_EVENT_TYPES)[number];
type TrackedEmailEvent = Extract<WebhookEventPayload, { type: TrackedEventType }>;

const TRACKED_EVENTS = new Set<WebhookEventPayload['type']>(TRACKED_EVENT_TYPES);

function isTrackedEmailEvent(
  event: WebhookEventPayload
): event is TrackedEmailEvent {
  return TRACKED_EVENTS.has(event.type);
}

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  });
}

function safeDetail(value: unknown) {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim();
  return /^[a-zA-Z0-9_.:-]{1,80}$/.test(cleaned) ? cleaned : null;
}

function eventDetails(event: TrackedEmailEvent) {
  if (event.type === 'email.bounced') {
    return {
      type: safeDetail(event.data?.bounce?.type),
      subtype: safeDetail(event.data?.bounce?.subType),
    };
  }
  if (event.type === 'email.suppressed') {
    return { type: safeDetail(event.data?.suppressed?.type) };
  }
  if (event.type === 'email.failed') {
    return { reason: safeDetail(event.data?.failed?.reason) };
  }
  return {};
}

export async function POST(request: Request) {
  const configuration = getEmailWebhookConfigurationStatus();
  if (configuration.state !== 'ready') {
    return json({ ok: false, error: 'webhook_not_configured' }, 503);
  }

  const svixId = request.headers.get('svix-id');
  const svixTimestamp = request.headers.get('svix-timestamp');
  const svixSignature = request.headers.get('svix-signature');
  if (!svixId || !svixTimestamp || !svixSignature) {
    return json({ ok: false, error: 'missing_signature_headers' }, 400);
  }

  const contentLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_WEBHOOK_BODY_BYTES) {
    return json({ ok: false, error: 'payload_too_large' }, 413);
  }

  let payload: string;
  try {
    payload = await request.text();
  } catch {
    return json({ ok: false, error: 'invalid_body' }, 400);
  }
  if (new TextEncoder().encode(payload).byteLength > MAX_WEBHOOK_BODY_BYTES) {
    return json({ ok: false, error: 'payload_too_large' }, 413);
  }

  let verified: WebhookEventPayload;
  try {
    verified = createResendWebhookVerifier().verify({
      payload,
      headers: {
        id: svixId,
        timestamp: svixTimestamp,
        signature: svixSignature,
      },
      webhookSecret: configuration.config.webhookSecret,
    });
  } catch {
    return json({ ok: false, error: 'invalid_signature' }, 400);
  }

  if (!isTrackedEmailEvent(verified)) {
    return json({ ok: true, ignored: true });
  }

  const providerEmailId = typeof verified.data?.email_id === 'string'
    ? verified.data.email_id
    : '';
  const eventCreatedAt = typeof verified.created_at === 'string'
    && !Number.isNaN(Date.parse(verified.created_at))
    ? verified.created_at
    : '';

  if (!providerEmailId || !eventCreatedAt) {
    return json({ ok: false, error: 'invalid_event' }, 400);
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc('record_resend_webhook_event', {
    p_svix_id: svixId,
    p_provider_email_id: providerEmailId,
    p_event_type: verified.type,
    p_event_created_at: eventCreatedAt,
    p_details: eventDetails(verified),
  });

  if (error || typeof data !== 'boolean') {
    console.error('Verified email webhook could not be recorded.');
    return json({ ok: false, error: 'webhook_storage_failed' }, 500);
  }

  return json({ ok: true, duplicate: !data });
}
