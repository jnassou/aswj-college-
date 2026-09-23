import Image from 'next/image';
import { login, signup } from './actions';
import { PendingSubmitButton } from '../auth/PendingSubmitButton';

type SearchValue = string | string[] | undefined;

function firstValue(value: SearchValue) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: SearchValue;
    mode?: SearchValue;
    created?: SearchValue;
    password_reset?: SearchValue;
    next?: SearchValue;
  }>;
}) {
  const params = await searchParams;
  const error = firstValue(params.error);
  const signupMode = firstValue(params.mode) === 'signup';
  const created = firstValue(params.created) === '1';
  const passwordReset = firstValue(params.password_reset) === '1';
  const nextPath = firstValue(params.next) === '/student/apply' ? '/student/apply' : null;

  const signInParams = new URLSearchParams();
  const signUpParams = new URLSearchParams({ mode: 'signup' });
  if (nextPath) {
    signInParams.set('next', nextPath);
    signUpParams.set('next', nextPath);
  }
  const signInHref = signInParams.size ? `/login?${signInParams.toString()}` : '/login';
  const signUpHref = `/login?${signUpParams.toString()}`;

  let message = '';
  if (created) message = 'Account created. Check your email to confirm your account, then sign in.';
  else if (passwordReset) message = 'Password updated. Sign in with your new password.';
  else if (error === 'invalid') message = 'Email or password was not accepted.';
  else if (error === 'missing') message = 'Enter a valid email and password.';
  else if (error === 'signup_fields') message = 'Complete all fields. Password must be between 8 and 256 characters.';
  else if (error === 'signup_failed') message = 'The account could not be created. The email may already be registered.';
  else if (error === 'signup_already_sent') message = 'A confirmation email was already requested. Check your inbox and junk folder before trying again.';
  else if (error === 'confirmation_failed') message = 'We could not complete sign-in from that confirmation link. Your email may already be confirmed, so try signing in or contact administration.';
  else if (error === 'confirm_required') message = 'Confirm your email address before applying for a class.';
  else if (error) message = 'Please check the details and try again.';

  const success = created || passwordReset;

  return (
    <main id="main-content" className="login-shell auth-shell" tabIndex={-1}>
      <div className="auth-layout">
        <section className="auth-brand-panel" aria-label="ASWJ Islamic College">
          <div className="auth-logo-panel">
            <Image
              className="auth-logo"
              src="/aswj-logo.png"
              alt="ASWJ Islamic College"
              width={650}
              height={390}
              priority
            />
          </div>
          <div className="auth-brand-copy">
            <span className="eyebrow eyebrow-on-dark">Student Portal</span>
            <p className="auth-brand-title">Your classes and applications, all in one place.</p>
            <p>Securely access application updates, class details, attendance and check-in.</p>
          </div>
        </section>

        <section className="login-card auth-panel" aria-labelledby="auth-heading">
          <header className="auth-header">
            <span className="eyebrow">ASWJ College</span>
            <h1 id="auth-heading">{signupMode ? 'Create your student account' : 'Welcome back'}</h1>
            <p className="subtitle">
              {signupMode
                ? 'Create an account before completing your first class application.'
                : 'Sign in to the ASWJ College Admin or Student Portal.'}
            </p>
          </header>

          {message && (
            <div
              className={`notice auth-notice${success ? ' success' : ''}`}
              role={success ? 'status' : 'alert'}
              aria-live="polite"
            >
              {message}
            </div>
          )}

          {signupMode ? (
            <form className="auth-form" action={signup}>
              {nextPath && <input type="hidden" name="next" value={nextPath} />}
              <div className="form-row auth-name-row">
                <div className="field">
                  <label htmlFor="signup-first-name">First name</label>
                  <input id="signup-first-name" name="first_name" autoComplete="given-name" maxLength={100} required />
                </div>
                <div className="field">
                  <label htmlFor="signup-last-name">Last name</label>
                  <input id="signup-last-name" name="last_name" autoComplete="family-name" maxLength={100} required />
                </div>
              </div>
              <div className="field">
                <label htmlFor="signup-email">Email address</label>
                <input id="signup-email" name="email" type="email" autoComplete="email" maxLength={320} required />
              </div>
              <div className="field">
                <label htmlFor="signup-password">Password</label>
                <input
                  id="signup-password"
                  name="password"
                  type="password"
                  minLength={8}
                  maxLength={256}
                  autoComplete="new-password"
                  aria-describedby="signup-password-helper"
                  required
                />
                <span id="signup-password-helper" className="field-helper">Use at least 8 characters.</span>
              </div>
              <PendingSubmitButton idleLabel="Create account" pendingLabel="Creating account…" />
              <p className="auth-switch">Already registered? <a className="text-link" href={signInHref}>Sign in</a></p>
            </form>
          ) : (
            <form className="auth-form" action={login}>
              {nextPath && <input type="hidden" name="next" value={nextPath} />}
              <div className="field">
                <label htmlFor="login-email">Email address</label>
                <input id="login-email" name="email" type="email" autoComplete="email" maxLength={320} required />
              </div>
              <div className="field">
                <label htmlFor="login-password">Password</label>
                <input id="login-password" name="password" type="password" autoComplete="current-password" maxLength={256} required />
              </div>
              <PendingSubmitButton idleLabel="Sign in" pendingLabel="Signing in…" />
              <p className="auth-switch"><a className="text-link" href="/forgot-password">Forgot your password?</a></p>
              <p className="auth-switch">New student? <a className="text-link" href={signUpHref}>Create an account</a></p>
            </form>
          )}

          <footer className="auth-footer">
            <a className="text-link" href="/apply">Back to class applications</a>
          </footer>
        </section>
      </div>
    </main>
  );
}
