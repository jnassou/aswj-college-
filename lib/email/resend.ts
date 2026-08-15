import 'server-only';

import { Resend } from 'resend';

export function createResendClient(apiKey: string) {
  return new Resend(apiKey, {
    userAgent: 'aswj-college/1.0',
  });
}

/**
 * Resend's local signature verifier is exposed through a client instance even
 * though it makes no API request and does not use an API key. Keep webhook
 * verification independent from sending credentials so delivery events can be
 * accepted while outbound email is paused or its API key is being rotated.
 */
export function createResendWebhookVerifier() {
  return new Resend('re_webhook_verification_only', {
    userAgent: 'aswj-college/1.0',
  }).webhooks;
}
