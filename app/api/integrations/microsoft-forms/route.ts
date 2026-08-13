import { NextRequest } from 'next/server';
import crypto from 'node:crypto';
import {
  FormsPayloadError,
  isJsonRecord,
  MAX_FORMS_PAYLOAD_BYTES,
  MICROSOFT_FORMS_PROVIDER,
  parseMicrosoftFormsSubmission,
} from '../../../../lib/microsoft-forms';
import { createSupabaseAdminClient } from '../../../../lib/supabase/admin';

export const runtime = 'nodejs';

function secureEqual(a: string, b: string) {
  const aa = crypto.createHash('sha256').update(a).digest();
  const bb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(aa, bb);
}

type IntakeState = {
  id: string;
  processing_status: string;
  processing_code: string | null;
  application_id: string | null;
  attempt_count: number;
};

type ProcessingResult = {
  result_status: string;
  result_code: string | null;
  result_application_id: string | null;
};

async function processSubmission(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  submissionId: string,
  expectedAttemptCount: number
) {
  const { data, error } = await supabase
    .rpc('process_external_form_submission', {
      p_submission_id: submissionId,
      p_actor_id: null,
    })
    .single();

  if (!error && data) {
    const result = data as ProcessingResult;
    return {
      ok: true as const,
      status: String(result.result_status),
      code: result.result_code ? String(result.result_code) : null,
      applicationId: result.result_application_id ? String(result.result_application_id) : null,
    };
  }

  const { data: current } = await supabase
    .from('external_form_submissions')
    .select('id,processing_status,processing_code,application_id,attempt_count')
    .eq('id', submissionId)
    .maybeSingle();

  if (
    current
    && (
      (current.processing_status === 'processed' && current.application_id)
      || current.processing_status === 'needs_review'
    )
  ) {
    return {
      ok: true as const,
      status: String(current.processing_status),
      code: current.processing_code ? String(current.processing_code) : null,
      applicationId: current.application_id ? String(current.application_id) : null,
    };
  }

  await supabase.rpc('record_external_form_processing_failure', {
    p_submission_id: submissionId,
    p_actor_id: null,
    p_code: 'processing_error',
    p_note: 'The stored submission could not be processed automatically.',
    p_expected_attempt_count: expectedAttemptCount,
  });

  const { data: failedState } = await supabase
    .from('external_form_submissions')
    .select('processing_status,processing_code,application_id')
    .eq('id', submissionId)
    .maybeSingle();

  if (
    failedState
    && (
      (failedState.processing_status === 'processed' && failedState.application_id)
      || failedState.processing_status === 'needs_review'
    )
  ) {
    return {
      ok: true as const,
      status: String(failedState.processing_status),
      code: failedState.processing_code ? String(failedState.processing_code) : null,
      applicationId: failedState.application_id ? String(failedState.application_id) : null,
    };
  }

  return {
    ok: false as const,
    status: failedState?.processing_status
      ? String(failedState.processing_status)
      : 'failed',
    code: failedState?.processing_code
      ? String(failedState.processing_code)
      : 'processing_error',
    applicationId: failedState?.application_id
      ? String(failedState.application_id)
      : null,
  };
}

export async function POST(request: NextRequest) {
  const configuredSecret = process.env.MS_FORMS_INGEST_SECRET;
  const suppliedSecret = request.headers.get('x-aswj-forms-secret') ?? '';
  if (!configuredSecret || !secureEqual(suppliedSecret, configuredSecret)) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > MAX_FORMS_PAYLOAD_BYTES) {
    return Response.json({ ok: false, error: 'Request body is too large.' }, { status: 413 });
  }

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return Response.json({ ok: false, error: 'The request body could not be read.' }, { status: 400 });
  }

  if (Buffer.byteLength(rawBody, 'utf8') > MAX_FORMS_PAYLOAD_BYTES) {
    return Response.json({ ok: false, error: 'Request body is too large.' }, { status: 413 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON.' }, { status: 400 });
  }

  if (!isJsonRecord(payload)) {
    return Response.json({ ok: false, error: 'The JSON body must be an object.' }, { status: 400 });
  }

  let parsed;
  try {
    parsed = parseMicrosoftFormsSubmission(payload);
  } catch (error) {
    if (error instanceof FormsPayloadError) {
      return Response.json({ ok: false, error: error.message }, { status: error.status });
    }
    return Response.json({ ok: false, error: 'The submission could not be validated.' }, { status: 400 });
  }

  const expectedFormId = process.env.MS_FORMS_FORM_ID?.trim();
  if (expectedFormId && !secureEqual(parsed.formId, expectedFormId)) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  let supabase;
  try {
    supabase = createSupabaseAdminClient();
  } catch {
    return Response.json({ ok: false, error: 'Database integration is not configured.' }, { status: 503 });
  }

  const payloadSha256 = crypto.createHash('sha256').update(rawBody).digest('hex');
  const { data, error } = await supabase
    .from('external_form_submissions')
    .insert({
      provider: MICROSOFT_FORMS_PROVIDER,
      external_form_id: parsed.formId,
      external_response_id: parsed.responseId,
      payload,
      payload_sha256: payloadSha256,
      mapped_payload: parsed.mappedPayload,
      validation_errors: parsed.validationErrors,
      normalized_email: parsed.normalizedEmail,
      selected_course: parsed.selectedCourse,
      student_first_name: parsed.mappedPayload.studentFirstName,
      student_last_name: parsed.mappedPayload.studentLastName,
      phone_number: parsed.mappedPayload.phoneNumber,
      completed_at: parsed.completedAt,
      processing_status: 'pending',
    })
    .select('id')
    .single();

  if (error?.code === '23505') {
    const { data: existing } = await supabase
      .from('external_form_submissions')
      .select('id,processing_status,processing_code,application_id,attempt_count')
      .eq('provider', MICROSOFT_FORMS_PROVIDER)
      .eq('external_form_id', parsed.formId)
      .eq('external_response_id', parsed.responseId)
      .maybeSingle();

    if (!existing) {
      return Response.json({ ok: false, error: 'The duplicate submission could not be read.' }, { status: 500 });
    }

    const existingState = existing as IntakeState;
    if (existingState.processing_status === 'pending') {
      const retried = await processSubmission(
        supabase,
        existingState.id,
        Number(existingState.attempt_count ?? 0)
      );
      if (!retried.ok) {
        return Response.json({
          ok: false,
          received: true,
          duplicate: true,
          submissionId: existingState.id,
          error: 'The submission was stored but requires administrator review.',
        }, { status: 500 });
      }

      return Response.json({
        ok: true,
        duplicate: true,
        submissionId: existingState.id,
        processingStatus: retried.status,
        processingCode: retried.code,
        applicationId: retried.applicationId,
      });
    }

    return Response.json({
      ok: true,
      duplicate: true,
      submissionId: existingState.id,
      processingStatus: existingState.processing_status,
      processingCode: existingState.processing_code,
      applicationId: existingState.application_id,
    });
  }

  if (error || !data) {
    return Response.json({ ok: false, error: 'The submission could not be stored.' }, { status: 500 });
  }

  const processing = await processSubmission(supabase, data.id, 0);
  if (!processing.ok) {
    return Response.json({
      ok: false,
      received: true,
      submissionId: data.id,
      error: 'The submission was stored but requires administrator review.',
    }, { status: 500 });
  }

  return Response.json({
    ok: true,
    submissionId: data.id,
    processingStatus: processing.status,
    processingCode: processing.code,
    applicationId: processing.applicationId,
  }, { status: processing.status === 'processed' ? 201 : 202 });
}
