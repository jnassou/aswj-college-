'use server';

import { revalidatePath } from 'next/cache';
import {
  processEmailDeliveryQueue,
  type EmailDeliveryBatchResult,
} from '../../../lib/email/worker';
import { requireAdmin } from '../../../lib/supabase/server';
import {
  combinedDeliveryStatus,
  optionalText,
  sanitizedDeliveryError,
} from './data';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type EmailDeliveryDetail = {
  id: string;
  studentName: string;
  event: string;
  className: string;
  recipientEmail: string;
  status: string;
  attemptCount: number;
  retryAllowed: boolean;
  queuedAt: string;
  lastAttemptAt: string | null;
  nextAttemptAt: string | null;
  sentAt: string | null;
  providerMessageId: string | null;
  lastError: string | null;
};

function requiredId(value: string) {
  if (!UUID_PATTERN.test(value)) {
    throw new Error('Email delivery not found.');
  }
  return value;
}

export async function getEmailDeliveryDetails(
  deliveryId: string
): Promise<EmailDeliveryDetail> {
  const { supabase } = await requireAdmin();
  const id = requiredId(deliveryId);
  const { data, error } = await supabase
    .rpc('admin_get_email_delivery', { p_delivery_id: id })
    .maybeSingle();

  if (error || !data) {
    if (error) {
      console.error(JSON.stringify({
        level: 'error',
        message: 'Admin email delivery details could not be loaded.',
        code: error.code,
      }));
    }
    throw new Error('Email delivery details could not be loaded.');
  }

  const row = data as Record<string, unknown>;
  const className = String(row.class_label ?? '').trim() || [
    optionalText(row.class_name),
    optionalText(row.class_term),
  ].filter(Boolean).join(' — ');
  return {
    id: String(row.delivery_id ?? row.id ?? id),
    studentName: String(row.student_name ?? 'Student'),
    event: String(row.event_label ?? row.template_key ?? 'Email notification'),
    className: className || '—',
    recipientEmail: String(row.recipient_email ?? '—'),
    status: combinedDeliveryStatus(row),
    attemptCount: Number(row.attempt_count ?? 0),
    retryAllowed: row.retry_allowed === true,
    queuedAt: String(row.queued_at ?? row.created_at ?? ''),
    lastAttemptAt: optionalText(row.last_attempt_at),
    nextAttemptAt: optionalText(row.next_attempt_at),
    sentAt: optionalText(row.sent_at),
    providerMessageId: optionalText(row.provider_message_id ?? row.provider_email_id),
    lastError: sanitizedDeliveryError(row),
  };
}

export async function retryEmailDelivery(deliveryId: string) {
  const { supabase } = await requireAdmin();
  const id = requiredId(deliveryId);
  const { data, error } = await supabase.rpc('admin_retry_email_delivery', {
    p_delivery_id: id,
  });

  if (error || data !== true) {
    console.error(JSON.stringify({
      level: 'error',
      message: 'Admin email delivery retry could not be queued.',
      code: error?.code ?? 'not_requeued',
    }));
    throw new Error('This email delivery could not be queued for retry.');
  }

  revalidatePath('/admin/email-delivery');
  return { status: 'queued' as const };
}

export async function processEmailQueueNow(): Promise<EmailDeliveryBatchResult> {
  await requireAdmin();

  try {
    const result = await processEmailDeliveryQueue({ limit: 10 });
    revalidatePath('/admin/email-delivery');
    return result;
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      message: 'Admin requested email queue processing failed.',
      error: error instanceof Error ? error.message : 'Unknown error',
    }));
    throw new Error('The email queue could not be processed. Try again shortly.');
  }
}
