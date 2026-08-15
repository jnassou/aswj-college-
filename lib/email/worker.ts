import 'server-only';

import crypto from 'node:crypto';
import type { ErrorResponse } from 'resend';
import { createSupabaseAdminClient } from '../supabase/admin';
import { getEmailConfigurationStatus } from './config';
import { createResendClient } from './resend';
import {
  isEmailTemplateKey,
  renderTransactionalEmail,
  type RenderedEmail,
} from './render';

const MAX_ATTEMPTS = 7;
const MAX_BATCH_SIZE = 10;
const DEFAULT_BATCH_SIZE = 5;
const DEFAULT_LEASE_SECONDS = 120;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ClaimedDelivery = {
  id: string;
  templateKey: string;
  recipientEmail: string;
  payload: unknown;
  attemptCount: number;
  templateVersion: string | null;
  subject: string | null;
  html: string | null;
  text: string | null;
};

export type EmailDeliveryBatchResult = {
  status: 'disabled' | 'not_configured' | 'processed';
  claimed: number;
  submitted: number;
  retryScheduled: number;
  failed: number;
};

type DeliveryQueueOptions = {
  limit?: number;
  leaseSeconds?: number;
};

type ClassifiedError = {
  code: string;
  message: string;
  retry: boolean;
  retryAfterSeconds: number | null;
};

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function nullableString(value: unknown) {
  const result = stringValue(value);
  return result || null;
}

function finiteInteger(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function claimedDelivery(value: unknown): ClaimedDelivery | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const id = stringValue(row.id ?? row.delivery_id);
  if (!UUID_PATTERN.test(id)) return null;

  return {
    id,
    templateKey: stringValue(row.template_key),
    recipientEmail: stringValue(row.recipient_email),
    payload: row.payload ?? row.template_payload ?? {},
    attemptCount: finiteInteger(row.attempt_count, 1),
    templateVersion: nullableString(row.template_version),
    subject: nullableString(row.subject ?? row.email_subject),
    html: nullableString(row.html ?? row.html_body),
    text: nullableString(row.text ?? row.text_body),
  };
}

function safeEmailAddress(value: string) {
  if (!value || value.length > 320 || /[\r\n\u0000]/.test(value)) return false;
  return /^[^\s<>@,]+@[^\s<>@,]+\.[^\s<>@,]+$/.test(value);
}

function providerError(
  error: ErrorResponse | null,
  headers: Record<string, string> | null
): ClassifiedError {
  if (!error) {
    return {
      code: 'provider_unavailable',
      message: 'The email provider could not be reached.',
      retry: true,
      retryAfterSeconds: null,
    };
  }

  const retryAfterHeader = headers?.['retry-after'] ?? headers?.['Retry-After'];
  const retryAfter = Number(retryAfterHeader);
  const retryAfterSeconds = Number.isFinite(retryAfter) && retryAfter > 0
    ? Math.min(Math.ceil(retryAfter), 86_400)
    : null;

  switch (error.name) {
    case 'rate_limit_exceeded':
      return {
        code: error.name,
        message: 'The email provider rate limit was reached.',
        retry: true,
        retryAfterSeconds,
      };
    case 'daily_quota_exceeded':
      return {
        code: error.name,
        message: 'The daily email quota was reached.',
        retry: true,
        retryAfterSeconds: retryAfterSeconds ?? 86_400,
      };
    case 'application_error':
    case 'internal_server_error':
    case 'concurrent_idempotent_requests':
      return {
        code: error.name,
        message: 'The email provider returned a temporary error.',
        retry: true,
        retryAfterSeconds,
      };
    case 'monthly_quota_exceeded':
      return {
        code: error.name,
        message: 'The monthly email quota was reached.',
        retry: false,
        retryAfterSeconds: null,
      };
    case 'missing_api_key':
    case 'restricted_api_key':
    case 'invalid_api_key':
      return {
        code: error.name,
        message: 'The email provider credentials are not valid for sending.',
        retry: false,
        retryAfterSeconds: null,
      };
    default:
      return {
        code: error.name || 'provider_rejected',
        message: 'The email provider rejected the message.',
        retry: false,
        retryAfterSeconds: null,
      };
  }
}

function thrownProviderError(): ClassifiedError {
  return {
    code: 'provider_unavailable',
    message: 'The email provider could not be reached.',
    retry: true,
    retryAfterSeconds: null,
  };
}

function retryDelaySeconds(attemptCount: number) {
  const schedule = [60, 300, 1_800, 7_200, 21_600, 86_400];
  return schedule[Math.min(Math.max(attemptCount - 1, 0), schedule.length - 1)];
}

function nextAttemptAt(attemptCount: number, retryAfterSeconds: number | null) {
  const seconds = Math.max(
    retryDelaySeconds(attemptCount),
    retryAfterSeconds ?? 0
  );
  return new Date(Date.now() + seconds * 1000).toISOString();
}

function zeroResult(status: 'disabled' | 'not_configured'): EmailDeliveryBatchResult {
  return {
    status,
    claimed: 0,
    submitted: 0,
    retryScheduled: 0,
    failed: 0,
  };
}

async function prepareDelivery(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  workerId: string,
  delivery: ClaimedDelivery,
  rendered: RenderedEmail
) {
  const { data, error } = await supabase.rpc('prepare_email_delivery', {
    p_delivery_id: delivery.id,
    p_worker_id: workerId,
    p_template_version: rendered.templateVersion,
    p_subject: rendered.subject,
    p_html: rendered.html,
    p_text: rendered.text,
  });

  if (error) throw new Error('The email delivery could not be prepared.');

  const rows = Array.isArray(data) ? data : [];
  const row = rows.length === 1 && rows[0] && typeof rows[0] === 'object'
    ? rows[0] as Record<string, unknown>
    : null;
  const deliveryId = stringValue(row?.delivery_id);
  const templateVersion = stringValue(row?.template_version);
  const subject = stringValue(row?.email_subject);
  const html = stringValue(row?.html_body);
  const text = stringValue(row?.text_body);

  if (
    deliveryId !== delivery.id
    || !templateVersion
    || !subject
    || !html
    || !text
  ) {
    throw new Error('The prepared email delivery was invalid.');
  }

  return { templateVersion, subject, html, text };
}

async function recordSubmitted(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  workerId: string,
  deliveryId: string,
  providerEmailId: string
) {
  const { data, error } = await supabase.rpc('record_email_submitted', {
    p_delivery_id: deliveryId,
    p_worker_id: workerId,
    p_provider_email_id: providerEmailId,
  });

  if (error || data !== true) {
    throw new Error('The submitted email could not be recorded.');
  }
}

async function markSubmissionStarted(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  workerId: string,
  deliveryId: string
) {
  const { data, error } = await supabase.rpc('mark_email_submission_started', {
    p_delivery_id: deliveryId,
    p_worker_id: workerId,
  });

  if (error || data !== true) {
    throw new Error('The email submission safety marker could not be recorded.');
  }
}

async function recordRetry(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  workerId: string,
  delivery: ClaimedDelivery,
  failure: ClassifiedError
) {
  const { data, error } = await supabase.rpc('record_email_retry', {
    p_delivery_id: delivery.id,
    p_worker_id: workerId,
    p_error_code: failure.code,
    p_error_message: failure.message,
    p_next_attempt_at: nextAttemptAt(delivery.attemptCount, failure.retryAfterSeconds),
  });

  if (error || data !== true) {
    throw new Error('The email retry could not be recorded.');
  }
}

async function recordFailed(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  workerId: string,
  deliveryId: string,
  code: string,
  message: string
) {
  const { data, error } = await supabase.rpc('record_email_failed', {
    p_delivery_id: deliveryId,
    p_worker_id: workerId,
    p_error_code: code,
    p_error_message: message,
  });

  if (error || data !== true) {
    throw new Error('The failed email could not be recorded.');
  }
}

export async function processEmailDeliveryQueue(
  options: DeliveryQueueOptions = {}
): Promise<EmailDeliveryBatchResult> {
  const configuration = getEmailConfigurationStatus();
  if (configuration.state === 'disabled') return zeroResult('disabled');
  if (configuration.state === 'not_configured') return zeroResult('not_configured');

  const limit = Math.min(
    Math.max(finiteInteger(options.limit, DEFAULT_BATCH_SIZE), 1),
    MAX_BATCH_SIZE
  );
  const leaseSeconds = Math.min(
    Math.max(finiteInteger(options.leaseSeconds, DEFAULT_LEASE_SECONDS), 30),
    600
  );
  const workerId = crypto.randomUUID();
  const supabase = createSupabaseAdminClient();
  const resend = createResendClient(configuration.config.apiKey);
  const { data, error } = await supabase.rpc('claim_email_deliveries', {
    p_worker_id: workerId,
    p_batch_limit: limit,
    p_lease_seconds: leaseSeconds,
  });

  if (error) throw new Error('The email delivery queue could not be claimed.');

  if (!Array.isArray(data)) {
    throw new Error('The claimed email delivery batch was invalid.');
  }

  const deliveries: ClaimedDelivery[] = data.map((value) => {
    const delivery = claimedDelivery(value);
    if (!delivery) throw new Error('A claimed email delivery was invalid.');
    return delivery;
  });
  const result: EmailDeliveryBatchResult = {
    status: 'processed',
    claimed: deliveries.length,
    submitted: 0,
    retryScheduled: 0,
    failed: 0,
  };

  for (const delivery of deliveries) {
    if (!safeEmailAddress(delivery.recipientEmail)) {
      await recordFailed(
        supabase,
        workerId,
        delivery.id,
        'invalid_recipient',
        'The stored recipient email address is invalid.'
      );
      result.failed += 1;
      continue;
    }

    if (!isEmailTemplateKey(delivery.templateKey)) {
      await recordFailed(
        supabase,
        workerId,
        delivery.id,
        'unsupported_template',
        'The email template is not supported.'
      );
      result.failed += 1;
      continue;
    }

    let rendered: RenderedEmail;
    if (
      delivery.templateVersion
      && delivery.subject
      && delivery.html
      && delivery.text
    ) {
      rendered = {
        templateVersion: delivery.templateVersion,
        subject: delivery.subject,
        html: delivery.html,
        text: delivery.text,
      };
    } else {
      rendered = await prepareDelivery(
        supabase,
        workerId,
        delivery,
        renderTransactionalEmail(
          delivery.templateKey,
          delivery.payload,
          configuration.config.appBaseUrl
        )
      );
    }

    let failure: ClassifiedError | null = null;
    let providerEmailId: string | null = null;
    // Persist the start of the potentially ambiguous provider request first.
    // This prevents any replay after Resend's idempotency protection window.
    await markSubmissionStarted(supabase, workerId, delivery.id);
    try {
      const response = await resend.emails.send(
        {
          from: configuration.config.from,
          to: delivery.recipientEmail,
          replyTo: configuration.config.replyTo,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
          tags: [
            { name: 'template', value: delivery.templateKey },
            { name: 'delivery_id', value: delivery.id },
          ],
        },
        {
          idempotencyKey: `aswj-email/${delivery.id}`,
        }
      );

      if (response.error || !response.data?.id) {
        failure = providerError(response.error, response.headers);
      } else {
        providerEmailId = response.data.id;
      }
    } catch {
      failure = thrownProviderError();
    }

    if (providerEmailId) {
      // Keep database failures outside the provider-error catch. If recording
      // fails, the lease expires and the same stable idempotency key is retried.
      await recordSubmitted(supabase, workerId, delivery.id, providerEmailId);
      result.submitted += 1;
      continue;
    }

    if (!failure) {
      throw new Error('The email provider returned an invalid response.');
    }

    if (failure.retry && delivery.attemptCount < MAX_ATTEMPTS) {
      await recordRetry(supabase, workerId, delivery, failure);
      result.retryScheduled += 1;
    } else {
      await recordFailed(
        supabase,
        workerId,
        delivery.id,
        failure.code,
        failure.message
      );
      result.failed += 1;
    }
  }

  return result;
}
