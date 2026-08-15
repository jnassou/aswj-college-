import { requireAdmin } from '../../../lib/supabase/server';
import { getEmailConfigurationStatus } from '../../../lib/email/config';
import EmailDeliveryClient, { type EmailDeliveryRow } from './EmailDeliveryClient';
import { combinedDeliveryStatus } from './data';

function classLabel(row: Record<string, unknown>) {
  const name = String(row.class_name ?? '').trim();
  const term = String(row.class_term ?? '').trim();
  return [name, term].filter(Boolean).join(' — ');
}

export default async function EmailDeliveryPage() {
  const { supabase } = await requireAdmin();
  const providerStatus = getEmailConfigurationStatus().state;
  const { data, error } = await supabase.rpc('admin_list_email_deliveries', {
    p_limit: 250,
  });

  if (error) {
    console.error(JSON.stringify({
      level: 'error',
      message: 'Admin email delivery list could not be loaded.',
      code: error.code,
    }));
    throw new Error('Email delivery history could not be loaded.');
  }

  const rows: EmailDeliveryRow[] = (data ?? []).map((value: unknown) => {
    const row = value as Record<string, unknown>;
    const attempts = Number(row.attempt_count ?? 0);
    return {
      id: String(row.delivery_id ?? row.id ?? ''),
      studentName: String(row.student_name ?? row.student_display_name ?? 'Student'),
      event: String(row.event_label ?? row.template_key ?? 'Email notification'),
      className: String(row.class_label ?? '').trim() || classLabel(row),
      queuedAt: String(row.queued_at ?? row.created_at ?? ''),
      status: combinedDeliveryStatus(row),
      attemptCount: Number.isFinite(attempts) ? attempts : 0,
      retryAllowed: row.retry_allowed === true,
    };
  });

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Email Delivery</h1>
          <p className="subtitle">
            Monitor queued student emails, review delivery details and safely retry failures.
          </p>
        </div>
      </div>
      <EmailDeliveryClient rows={rows} providerStatus={providerStatus} />
    </>
  );
}
