'use server';

import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '../../../../lib/supabase/server';

export async function verifyPasswordRecovery(formData: FormData) {
  const tokenHash = String(formData.get('token_hash') ?? '');
  if (tokenHash.length < 20 || tokenHash.length > 2048 || /\s/.test(tokenHash)) {
    redirect('/forgot-password?error=expired');
  }

  let supabase;
  try {
    supabase = await createSupabaseServerClient();
  } catch {
    redirect('/forgot-password?error=unavailable');
  }

  let failed = false;

  try {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: 'recovery',
    });
    failed = Boolean(error);
  } catch {
    failed = true;
  }

  if (failed) redirect('/forgot-password?error=expired');
  redirect('/reset-password');
}
