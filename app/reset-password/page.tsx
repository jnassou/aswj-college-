import Image from 'next/image';
import { redirect } from 'next/navigation';
import { PendingSubmitButton } from '../auth/PendingSubmitButton';
import { createSupabaseServerClient } from '../../lib/supabase/server';
import { updatePassword } from './actions';

type SearchValue = string | string[] | undefined;

function firstValue(value: SearchValue) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: SearchValue }>;
}) {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) redirect('/forgot-password?error=expired');

  const params = await searchParams;
  const error = firstValue(params.error);
  const message = error === 'length'
    ? 'Use a password between 8 and 256 characters.'
    : error === 'mismatch'
      ? 'The passwords do not match.'
      : error === 'policy'
        ? 'That password does not meet the account security rules. Choose a longer, less common password and try again.'
        : error === 'same'
          ? 'Choose a password different from your current password.'
          : error === 'reauthenticate'
            ? 'For security, request a new password reset link and try again.'
            : error
              ? 'The password could not be updated. Try again, or request a new reset link if the problem continues.'
              : '';

  return (
    <main id="main-content" className="login-shell" tabIndex={-1}>
      <section className="login-card" aria-labelledby="reset-heading">
        <Image
          className="login-logo"
          src="/aswj-logo.png"
          alt="ASWJ Islamic College"
          width={650}
          height={390}
          priority
        />
        <header className="auth-header">
          <span className="eyebrow">ASWJ College</span>
          <h1 id="reset-heading">Choose a new password</h1>
          <p className="subtitle">Set a new password for {user.email ?? 'your student account'}.</p>
        </header>

        {message && <div className="notice auth-notice" role="alert">{message}</div>}

        <form className="auth-form" action={updatePassword}>
          <div className="field">
            <label htmlFor="new-password">New password</label>
            <input
              id="new-password"
              name="password"
              type="password"
              minLength={8}
              maxLength={256}
              autoComplete="new-password"
              aria-describedby="new-password-helper"
              required
            />
            <span id="new-password-helper" className="field-helper">Use at least 8 characters.</span>
          </div>
          <div className="field">
            <label htmlFor="password-confirmation">Confirm new password</label>
            <input
              id="password-confirmation"
              name="password_confirmation"
              type="password"
              minLength={8}
              maxLength={256}
              autoComplete="new-password"
              required
            />
          </div>
          <PendingSubmitButton idleLabel="Update password" pendingLabel="Updating password…" />
        </form>
      </section>
    </main>
  );
}
