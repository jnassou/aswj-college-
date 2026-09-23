import Image from 'next/image';
import { PendingSubmitButton } from '../auth/PendingSubmitButton';
import { requestPasswordReset } from './actions';

type SearchValue = string | string[] | undefined;

function firstValue(value: SearchValue) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: SearchValue; error?: SearchValue }>;
}) {
  const params = await searchParams;
  const sent = firstValue(params.sent) === '1';
  const error = firstValue(params.error);
  const message = sent
    ? 'If an account exists for that address, a password reset email has been sent. Check your inbox and junk folder.'
    : error === 'expired'
      ? 'That password reset link is invalid or has expired. Request a new one.'
      : error
        ? 'Password recovery is temporarily unavailable. Please try again later.'
        : '';

  return (
    <main id="main-content" className="login-shell" tabIndex={-1}>
      <section className="login-card" aria-labelledby="recovery-heading">
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
          <h1 id="recovery-heading">Reset your password</h1>
          <p className="subtitle">Enter the email address used for your student account.</p>
        </header>

        {message && (
          <div className={`notice auth-notice${sent ? ' success' : ''}`} role={sent ? 'status' : 'alert'}>
            {message}
          </div>
        )}

        {!sent && (
          <form className="auth-form" action={requestPasswordReset}>
            <div className="field">
              <label htmlFor="recovery-email">Email address</label>
              <input id="recovery-email" name="email" type="email" autoComplete="email" maxLength={320} required />
            </div>
            <PendingSubmitButton idleLabel="Send reset email" pendingLabel="Sending reset email…" />
          </form>
        )}

        <p className="auth-switch"><a className="text-link" href="/login">Back to sign in</a></p>
      </section>
    </main>
  );
}
