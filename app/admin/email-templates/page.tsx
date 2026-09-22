import { requireAdmin } from '../../../lib/supabase/server';
import EmailTemplatesClient, { type EmailTemplateRow } from './EmailTemplatesClient';

function text(value: unknown, fallback = '') {
  const result = String(value ?? '').trim();
  return result || fallback;
}

function allowedVariables(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((item) => text(item)).filter(Boolean);
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map((item) => text(item)).filter(Boolean);
    } catch {
      return value.split(',').map((item) => item.trim()).filter(Boolean);
    }
  }
  return [];
}

export default async function EmailTemplatesPage() {
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase.rpc('admin_list_email_templates');

  if (error) {
    console.error(JSON.stringify({
      level: 'error',
      message: 'Admin email templates could not be loaded.',
      code: error.code,
    }));
    throw new Error('Email messages could not be loaded.');
  }

  const rows: EmailTemplateRow[] = (Array.isArray(data) ? data : []).map((value: unknown) => {
    const row = value as Record<string, unknown>;
    const version = Number(row.active_version ?? 1);
    return {
      templateKey: text(row.template_key),
      category: text(row.category, 'Student email'),
      eventLabel: text(row.event_label ?? row.template_key, 'Email notification'),
      sentWhen: text(row.sent_when, 'When the related student event occurs.'),
      allowedVariables: allowedVariables(row.allowed_variables),
      activeVersion: Number.isSafeInteger(version) && version > 0 ? version : 1,
      subjectTemplate: text(row.subject_template),
      previewTemplate: text(row.preview_template),
      headingTemplate: text(row.heading_template),
      bodyTemplate: text(row.body_template),
      buttonLabel: text(row.button_label),
      updatedAt: text(row.updated_at) || null,
    };
  });

  return (
    <>
      <div className="topbar email-templates-topbar">
        <div>
          <h1>Email Messages</h1>
          <p className="subtitle">
            Edit the replies students receive for account, application and enrolment events.
          </p>
        </div>
        <a className="btn btn-outline" href="/admin/email-delivery">View delivery history</a>
      </div>
      <EmailTemplatesClient rows={rows} />
    </>
  );
}
