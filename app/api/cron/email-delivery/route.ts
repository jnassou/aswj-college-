import crypto from 'node:crypto';
import { getEmailConfigurationStatus } from '../../../../lib/email/config';
import { processEmailDeliveryQueue } from '../../../../lib/email/worker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const RESPONSE_HEADERS = {
  'Cache-Control': 'no-store, max-age=0',
};

function secureEqual(a: string, b: string) {
  const aa = crypto.createHash('sha256').update(a).digest();
  const bb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(aa, bb);
}

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: RESPONSE_HEADERS });
}

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET ?? '';
  if (!cronSecret || cronSecret.length < 32 || /[\s\u0000-\u001f\u007f]/.test(cronSecret)) {
    return json({ ok: false, error: 'cron_not_configured' }, 503);
  }

  const suppliedAuthorization = request.headers.get('authorization') ?? '';
  if (!secureEqual(suppliedAuthorization, `Bearer ${cronSecret}`)) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  const configuration = getEmailConfigurationStatus();
  if (configuration.state !== 'ready') {
    return json({ ok: false, error: `email_${configuration.state}` }, 503);
  }

  try {
    const result = await processEmailDeliveryQueue({ limit: 5, leaseSeconds: 120 });
    return json({ ok: true, ...result });
  } catch {
    // Do not log or return provider payloads, recipient addresses, or secret values.
    console.error('Email delivery cron failed.');
    return json({ ok: false, error: 'email_delivery_failed' }, 500);
  }
}
