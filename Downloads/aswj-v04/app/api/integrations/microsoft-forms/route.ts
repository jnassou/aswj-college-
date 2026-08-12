import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

function secureEqual(a: string, b: string) {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

export async function POST(request: NextRequest) {
  const configuredSecret = process.env.MS_FORMS_INGEST_SECRET;
  const suppliedSecret = request.headers.get('x-aswj-forms-secret') ?? '';
  if (!configuredSecret || !secureEqual(suppliedSecret, configuredSecret)) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return Response.json({ ok: false, error: 'Database integration is not configured' }, { status: 503 });
  }

  let payload: unknown;
  try { payload = await request.json(); }
  catch { return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }

  const body = payload as Record<string, unknown>;
  const externalResponseId = String(body.responseId ?? body.response_id ?? '');
  const formId = String(body.formId ?? body.form_id ?? '');
  if (!externalResponseId) {
    return Response.json({ ok: false, error: 'responseId is required' }, { status: 400 });
  }

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await supabase.from('external_form_submissions').upsert({
    provider: 'microsoft_forms',
    external_form_id: formId || null,
    external_response_id: externalResponseId,
    payload: body,
    received_at: new Date().toISOString(),
    processing_status: 'pending',
  }, { onConflict: 'provider,external_response_id' }).select('id').single();

  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true, submissionId: data.id }, { status: 202 });
}
