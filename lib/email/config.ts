import 'server-only';

export type EmailConfigurationStatus =
  | { state: 'disabled'; missing: string[] }
  | { state: 'not_configured'; missing: string[] }
  | { state: 'ready'; missing: []; config: EmailConfiguration };

export type EmailConfiguration = {
  apiKey: string;
  from: string;
  replyTo: string;
  appBaseUrl: string;
  recipientOverride: string | null;
  subjectPrefix: string;
};

export type EmailWebhookConfigurationStatus =
  | { state: 'not_configured'; missing: string[] }
  | {
      state: 'ready';
      missing: [];
      config: { webhookSecret: string };
    };

function clean(value: string | undefined) {
  return value?.trim() ?? '';
}

function isSafeSecret(value: string) {
  return value.length >= 8
    && value.length <= 500
    && !/[\s\u0000-\u001f\u007f]/.test(value);
}

function isSafeMailboxHeader(value: string) {
  if (!value || value.length > 500 || /[\r\n\u0000]/.test(value)) return false;

  const bareMailbox = /^[^\s<>@,]+@[^\s<>@,]+\.[^\s<>@,]+$/;
  const namedMailbox = /^[^<>]{1,200}<([^\s<>@,]+@[^\s<>@,]+\.[^\s<>@,]+)>$/;
  return bareMailbox.test(value) || namedMailbox.test(value);
}

function normalizedBaseUrl(value: string) {
  try {
    const url = new URL(value);
    const localDevelopment = process.env.NODE_ENV !== 'production'
      && ['localhost', '127.0.0.1'].includes(url.hostname);

    if (
      (url.protocol !== 'https:' && !(localDevelopment && url.protocol === 'http:'))
      || url.username
      || url.password
      || url.pathname !== '/'
      || url.search
      || url.hash
    ) {
      return null;
    }

    return url.origin;
  } catch {
    return null;
  }
}

function supabaseProjectRef(value: string) {
  try {
    const match = new URL(value).hostname.match(/^([a-z0-9]{20})\.supabase\.co$/i);
    return match?.[1]?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

function safeProjectRef(value: string) {
  return /^[a-z0-9]{20}$/.test(value) ? value : null;
}

/**
 * Email is an optional operational integration. Configuration is evaluated only
 * at runtime so builds and the core Student Portal continue to work without a
 * provider. When enabled, every required value must be valid before a worker is
 * allowed to claim an outbox row.
 */
export function getEmailConfigurationStatus(): EmailConfigurationStatus {
  // Only Vercel's explicit production marker may unlock real recipients.
  // A local `next start` process also has NODE_ENV=production, but it must
  // remain inside the test-recipient safety rail.
  const nonProductionDeployment = process.env.VERCEL_ENV !== 'production';
  if (clean(process.env.EMAIL_DELIVERY_ENABLED).toLowerCase() !== 'true') {
    return { state: 'disabled', missing: [] };
  }

  const apiKey = clean(process.env.RESEND_API_KEY);
  const webhookSecret = clean(process.env.RESEND_WEBHOOK_SECRET);
  const from = clean(process.env.EMAIL_FROM);
  const replyTo = clean(process.env.EMAIL_REPLY_TO);
  const rawBaseUrl = clean(process.env.EMAIL_APP_BASE_URL);
  const appBaseUrl = normalizedBaseUrl(rawBaseUrl);
  const testRecipient = clean(process.env.EMAIL_DELIVERY_TEST_RECIPIENT);
  const supabaseUrl = clean(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const currentProjectRef = supabaseProjectRef(supabaseUrl);
  const expectedProjectRef = safeProjectRef(
    clean(process.env.EMAIL_DELIVERY_EXPECTED_SUPABASE_PROJECT_REF).toLowerCase()
  );
  const productionProjectRef = safeProjectRef(
    clean(process.env.EMAIL_DELIVERY_PRODUCTION_SUPABASE_PROJECT_REF).toLowerCase()
  );
  const missing: string[] = [];

  if (!isSafeSecret(apiKey)) missing.push('RESEND_API_KEY');
  if (!isSafeSecret(webhookSecret)) missing.push('RESEND_WEBHOOK_SECRET');
  if (!isSafeMailboxHeader(from)) missing.push('EMAIL_FROM');
  if (!isSafeMailboxHeader(replyTo)) missing.push('EMAIL_REPLY_TO');
  if (!appBaseUrl) missing.push('EMAIL_APP_BASE_URL');
  if (!currentProjectRef) missing.push('NEXT_PUBLIC_SUPABASE_URL');
  if (!clean(process.env.SUPABASE_SERVICE_ROLE_KEY)) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!expectedProjectRef || currentProjectRef !== expectedProjectRef) {
    missing.push('EMAIL_DELIVERY_EXPECTED_SUPABASE_PROJECT_REF');
  }
  if (nonProductionDeployment && !isSafeMailboxHeader(testRecipient)) {
    missing.push('EMAIL_DELIVERY_TEST_RECIPIENT');
  }
  if (
    nonProductionDeployment
    && (!productionProjectRef || currentProjectRef === productionProjectRef)
  ) {
    missing.push('EMAIL_DELIVERY_PRODUCTION_SUPABASE_PROJECT_REF');
  }

  if (missing.length > 0 || !appBaseUrl) {
    return { state: 'not_configured', missing };
  }

  return {
    state: 'ready',
    missing: [],
    config: {
      apiKey,
      from,
      replyTo,
      appBaseUrl,
      recipientOverride: nonProductionDeployment ? testRecipient : null,
      subjectPrefix: nonProductionDeployment ? '[DEV] ' : '',
    },
  };
}

/**
 * Provider status callbacks remain available while outbound delivery is
 * paused. This deliberately ignores EMAIL_DELIVERY_ENABLED and outbound-only
 * values so late delivery, bounce and complaint events are not lost.
 */
export function getEmailWebhookConfigurationStatus(): EmailWebhookConfigurationStatus {
  const webhookSecret = clean(process.env.RESEND_WEBHOOK_SECRET);
  const missing: string[] = [];

  if (!isSafeSecret(webhookSecret)) missing.push('RESEND_WEBHOOK_SECRET');
  if (!clean(process.env.NEXT_PUBLIC_SUPABASE_URL)) missing.push('NEXT_PUBLIC_SUPABASE_URL');
  if (!clean(process.env.SUPABASE_SERVICE_ROLE_KEY)) missing.push('SUPABASE_SERVICE_ROLE_KEY');

  if (missing.length > 0) {
    return { state: 'not_configured', missing };
  }

  return {
    state: 'ready',
    missing: [],
    config: { webhookSecret },
  };
}

export function studentPortalUrl(appBaseUrl: string) {
  return new URL('/student', appBaseUrl).toString();
}
