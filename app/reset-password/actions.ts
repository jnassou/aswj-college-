'use server';

import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '../../lib/supabase/server';

function resetPasswordRedirect(error: string): never {
  redirect(`/reset-password?error=${encodeURIComponent(error)}`);
}

export async function updatePassword(formData: FormData) {
  const password = String(formData.get('password') ?? '');
  const confirmation = String(formData.get('password_confirmation') ?? '');

  if (password.length < 8 || password.length > 256) resetPasswordRedirect('length');
  if (password !== confirmation) resetPasswordRedirect('mismatch');

  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) redirect('/forgot-password?error=expired');

  let failure: { code?: string } | null = null;
  try {
    const { error } = await supabase.auth.updateUser({ password });
    failure = error;
  } catch {
    failure = { code: 'request_failed' };
  }

  if (failure?.code === 'weak_password') resetPasswordRedirect('policy');
  if (failure?.code === 'same_password') resetPasswordRedirect('same');
  if (failure?.code === 'reauthentication_needed') resetPasswordRedirect('reauthenticate');
  if (failure) resetPasswordRedirect('failed');

  try {
    await supabase.auth.signOut();
  } catch {
    // The password is already updated. Do not present the completed change as a failure.
  }
  redirect('/login?password_reset=1');
}
