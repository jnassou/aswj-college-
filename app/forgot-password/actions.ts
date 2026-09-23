'use server';

import { redirect } from 'next/navigation';
import { applicationUrl } from '../../lib/auth/application-origin';
import { createSupabaseServerClient } from '../../lib/supabase/server';

function forgotPasswordRedirect(params: Record<string, string>): never {
  redirect(`/forgot-password?${new URLSearchParams(params).toString()}`);
}

export async function requestPasswordReset(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim().toLowerCase();

  // Use the same response for malformed and unknown addresses so this form
  // cannot be used to discover which students have accounts.
  if (!email || email.length > 320) forgotPasswordRedirect({ sent: '1' });

  const redirectTo = applicationUrl('/auth/recovery');
  if (!redirectTo) forgotPasswordRedirect({ error: 'unavailable' });

  let supabase;
  try {
    supabase = await createSupabaseServerClient();
  } catch {
    console.error('Password recovery is not configured.', { code: 'configuration_unavailable' });
    forgotPasswordRedirect({ error: 'unavailable' });
  }

  let failure: { code?: string; status?: number } | null = null;

  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    failure = error;
  } catch {
    failure = { code: 'request_failed' };
  }

  if (failure) {
    console.error('Password recovery request failed.', {
      code: failure.code,
      status: failure.status,
    });
  }

  forgotPasswordRedirect({ sent: '1' });
}
