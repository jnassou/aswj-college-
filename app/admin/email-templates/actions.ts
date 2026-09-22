'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '../../../lib/supabase/server';

const TEMPLATE_KEY_PATTERN = /^[a-z][a-z0-9_]{2,79}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u0009\u000B\u000C\u000E-\u001F\u007F]/;
const PLACEHOLDER_PATTERN = /{{([a-z][a-z0-9_]*)}}/g;

export type EmailTemplateUpdateInput = {
  templateKey: string;
  expectedVersion: number;
  subjectTemplate: string;
  previewTemplate: string;
  headingTemplate: string;
  bodyTemplate: string;
  buttonLabel: string;
};

type TemplateRule = {
  allowedVariables: string[];
};
type AdminSupabaseClient = Awaited<ReturnType<typeof requireAdmin>>['supabase'];

function requiredTemplateKey(value: string) {
  const key = String(value ?? '').trim();
  if (!TEMPLATE_KEY_PATTERN.test(key)) {
    throw new Error('Email message not found.');
  }
  return key;
}

function requiredVersion(value: number) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error('Refresh the page before saving this message.');
  }
  return value;
}

function textField(
  value: string,
  label: string,
  minimum: number,
  maximum: number,
  multiline = false
) {
  const text = String(value ?? '').trim();
  if (text.length < minimum || text.length > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum} characters.`);
  }
  if (CONTROL_CHARACTER_PATTERN.test(text)) {
    throw new Error(`${label} contains an unsupported character.`);
  }
  if (!multiline && /[\r\n]/.test(text)) {
    throw new Error(`${label} must be on one line.`);
  }
  return text;
}

function parseAllowedVariables(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item).trim()).filter(Boolean);
      }
    } catch {
      return value.split(',').map((item) => item.trim()).filter(Boolean);
    }
  }
  return [];
}

function validatePlaceholders(value: string, allowedVariables: string[], label: string) {
  const allowed = new Set(allowedVariables);
  const unknown = new Set<string>();
  const stripped = value.replace(PLACEHOLDER_PATTERN, (_match, variable: string) => {
    if (!allowed.has(variable)) unknown.add(variable);
    return '';
  });

  if (stripped.includes('{{') || stripped.includes('}}')) {
    throw new Error(`${label} contains an incomplete placeholder.`);
  }
  if (unknown.size > 0) {
    throw new Error(`${label} contains an unavailable placeholder: ${Array.from(unknown).join(', ')}.`);
  }
}

async function templateRule(
  supabase: AdminSupabaseClient,
  templateKey: string
): Promise<TemplateRule> {
  const { data, error } = await supabase.rpc('admin_list_email_templates');

  if (error) {
    console.error(JSON.stringify({
      level: 'error',
      message: 'Admin email template rules could not be loaded.',
      code: error.code,
    }));
    throw new Error('Email message settings could not be loaded. Refresh and try again.');
  }

  const row = (Array.isArray(data) ? data : []).find((value: unknown) => {
    const candidate = value as Record<string, unknown>;
    return String(candidate.template_key ?? '') === templateKey;
  }) as Record<string, unknown> | undefined;

  if (!row) throw new Error('Email message not found.');
  return { allowedVariables: parseAllowedVariables(row.allowed_variables) };
}

function isVersionConflict(error: { message?: string } | null) {
  return /version|changed|refresh|stale/i.test(error?.message ?? '');
}

export async function updateEmailTemplate(input: EmailTemplateUpdateInput) {
  const { supabase } = await requireAdmin();
  const templateKey = requiredTemplateKey(input.templateKey);
  const expectedVersion = requiredVersion(input.expectedVersion);
  const subjectTemplate = textField(input.subjectTemplate, 'Subject', 1, 160);
  const previewTemplate = textField(input.previewTemplate, 'Preview text', 1, 200);
  const headingTemplate = textField(input.headingTemplate, 'Heading', 1, 120);
  const bodyTemplate = textField(input.bodyTemplate, 'Message', 1, 5000, true);
  const buttonLabel = textField(input.buttonLabel, 'Button label', 1, 80);
  const { allowedVariables } = await templateRule(supabase, templateKey);

  for (const [label, value] of [
    ['Subject', subjectTemplate],
    ['Preview text', previewTemplate],
    ['Heading', headingTemplate],
    ['Message', bodyTemplate],
    ['Button label', buttonLabel],
  ] as const) {
    validatePlaceholders(value, allowedVariables, label);
  }

  const { data, error } = await supabase.rpc('admin_update_email_template', {
    p_template_key: templateKey,
    p_expected_version: expectedVersion,
    p_subject_template: subjectTemplate,
    p_preview_template: previewTemplate,
    p_heading_template: headingTemplate,
    p_body_template: bodyTemplate,
    p_button_label: buttonLabel,
  });

  if (error || data !== true) {
    console.error(JSON.stringify({
      level: 'error',
      message: 'Admin email template could not be updated.',
      code: error?.code ?? 'not_updated',
    }));
    if (data === false || isVersionConflict(error)) {
      throw new Error('This message was changed by someone else. Refresh the page and try again.');
    }
    throw new Error('The email message could not be saved. Try again.');
  }

  revalidatePath('/admin/email-templates');
  return { status: 'saved' as const };
}

export async function resetEmailTemplate(templateKeyValue: string, expectedVersionValue: number) {
  const templateKey = requiredTemplateKey(templateKeyValue);
  const expectedVersion = requiredVersion(expectedVersionValue);
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase.rpc('admin_reset_email_template', {
    p_template_key: templateKey,
    p_expected_version: expectedVersion,
  });

  if (error || data !== true) {
    console.error(JSON.stringify({
      level: 'error',
      message: 'Admin email template could not be reset.',
      code: error?.code ?? 'not_reset',
    }));
    if (data === false || isVersionConflict(error)) {
      throw new Error('This message was changed by someone else. Refresh the page and try again.');
    }
    throw new Error('The email message could not be restored. Try again.');
  }

  revalidatePath('/admin/email-templates');
  return { status: 'reset' as const };
}
