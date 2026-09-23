import Image from 'next/image';
import { redirect } from 'next/navigation';
import { PendingSubmitButton } from '../../PendingSubmitButton';
import { verifyPasswordRecovery } from './actions';

type SearchValue = string | string[] | undefined;

function firstValue(value: SearchValue) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function VerifyPasswordRecoveryPage({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: SearchValue; type?: SearchValue }>;
}) {
  const params = await searchParams;
  const tokenHash = firstValue(params.token_hash) ?? '';
  const type = firstValue(params.type);

  if (type !== 'recovery' || tokenHash.length < 20 || tokenHash.length > 2048 || /\s/.test(tokenHash)) {
    redirect('/forgot-password?error=expired');
  }

  return (
    <main id="main-content" className="login-shell" tabIndex={-1}>
      <section className="login-card" aria-labelledby="recovery-verify-heading">
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
          <h1 id="recovery-verify-heading">Continue to reset your password</h1>
          <p className="subtitle">For your security, confirm that you want to choose a new password.</p>
        </header>

        <form className="auth-form" action={verifyPasswordRecovery}>
          <input name="token_hash" type="hidden" value={tokenHash} />
          <PendingSubmitButton idleLabel="Continue" pendingLabel="Checking link…" />
        </form>

        <p className="auth-switch"><a className="text-link" href="/login">Back to sign in</a></p>
      </section>
    </main>
  );
}
