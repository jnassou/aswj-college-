import Image from 'next/image';
import { login, signup } from './actions';

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
    next?: SearchValue;
  }>;
}) {
  const params = await searchParams;
  const error = firstValue(params.error);
  const signupMode = firstValue(params.mode) === 'signup';
  const created = firstValue(params.created) === '1';
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
  else if (error === 'invalid') message = 'Email or password was not accepted.';
  else if (error === 'missing') message = 'Enter a valid email and password.';
  else if (error === 'signup_fields') message = 'Complete all fields. Password must be between 8 and 256 characters.';
  else if (error === 'signup_failed') message = 'The account could not be created. The email may already be registered.';
  else if (error === 'confirm_required') message = 'Confirm your email address before applying for a class.';
  else if (error) message = 'Please check the details and try again.';

  return (
    <main className="login-shell">
      <section className="login-card">
        <Image className="login-logo" src="/aswj-logo.png" alt="ASWJ Islamic College" width={650} height={390} priority />
        <h1>{signupMode ? 'Create Student Account' : 'Sign in'}</h1>
        <p className="subtitle">
          {signupMode ? 'ASWJ College Student Portal' : 'ASWJ College Admin & Student Portal'}
        </p>

        {message && (
          <div
            className="notice"
            role={created ? 'status' : 'alert'}
            aria-live="polite"
            style={{ marginTop: 18 }}
          >
            {message}
          </div>
        )}

        {signupMode ? (
          <form action={signup} style={{ marginTop: 20 }}>
            {nextPath && <input type="hidden" name="next" value={nextPath} />}
            <div className="field">
              <label htmlFor="signup-first-name">First name</label>
              <input id="signup-first-name" name="first_name" autoComplete="given-name" maxLength={100} required />
            </div>
            <div className="field">
              <label htmlFor="signup-last-name">Last name</label>
              <input id="signup-last-name" name="last_name" autoComplete="family-name" maxLength={100} required />
            </div>
            <div className="field">
              <label htmlFor="signup-email">Email</label>
              <input id="signup-email" name="email" type="email" autoComplete="email" maxLength={320} required />
            </div>
            <div className="field">
              <label htmlFor="signup-password">Password</label>
              <input id="signup-password" name="password" type="password" minLength={8} maxLength={256} autoComplete="new-password" required />
            </div>
            <button className="btn btn-primary" type="submit">Create account</button>
            <p className="small" style={{ marginTop: 18 }}>Already registered? <a href={signInHref}>Sign in</a></p>
          </form>
        ) : (
          <form action={login} style={{ marginTop: 20 }}>
            {nextPath && <input type="hidden" name="next" value={nextPath} />}
            <div className="field">
              <label htmlFor="login-email">Email</label>
              <input id="login-email" name="email" type="email" autoComplete="email" maxLength={320} required />
            </div>
            <div className="field">
              <label htmlFor="login-password">Password</label>
              <input id="login-password" name="password" type="password" autoComplete="current-password" maxLength={256} required />
            </div>
            <button className="btn btn-primary" type="submit">Sign in</button>
            <p className="small" style={{ marginTop: 18 }}>New student? <a href={signUpHref}>Create an account</a></p>
          </form>
        )}

        <p className="small" style={{ marginTop: 18 }}><a href="/apply">Back to class applications</a></p>
      </section>
    </main>
  );
}
