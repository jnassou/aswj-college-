import { login, signup } from './actions';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; mode?: string; created?: string }>;
}) {
  const params = await searchParams;
  const signupMode = params.mode === 'signup';

  let message = '';
  if (params.created === '1') message = 'Account created. Check your email to confirm your account, then sign in.';
  else if (params.error === 'invalid') message = 'Email or password was not accepted.';
  else if (params.error === 'signup_fields') message = 'Complete all fields. Password must be at least 8 characters.';
  else if (params.error === 'signup_failed') message = 'The account could not be created. The email may already be registered.';
  else if (params.error) message = 'Please check the details and try again.';

  return (
    <main style={{ maxWidth: 500, margin: '64px auto', padding: '0 20px' }}>
      <section className="section">
        <div className="small">ASWJ College</div>
        <h1>{signupMode ? 'Create Student Account' : 'Sign in'}</h1>
        <p className="subtitle">
          {signupMode ? 'ASWJ College Student Portal' : 'ASWJ College Admin & Student Portal'}
        </p>

        {message && <div className="notice" style={{ marginTop: 18 }}>{message}</div>}

        {signupMode ? (
          <form action={signup} style={{ marginTop: 20 }}>
            <div className="field"><label>First name</label><input name="first_name" autoComplete="given-name" required /></div>
            <div className="field"><label>Last name</label><input name="last_name" autoComplete="family-name" required /></div>
            <div className="field"><label>Email</label><input name="email" type="email" autoComplete="email" required /></div>
            <div className="field"><label>Password</label><input name="password" type="password" minLength={8} autoComplete="new-password" required /></div>
            <button className="btn btn-primary" type="submit">Create account</button>
            <p className="small" style={{ marginTop: 18 }}>Already registered? <a href="/login">Sign in</a></p>
          </form>
        ) : (
          <form action={login} style={{ marginTop: 20 }}>
            <div className="field"><label>Email</label><input name="email" type="email" autoComplete="email" required /></div>
            <div className="field"><label>Password</label><input name="password" type="password" autoComplete="current-password" required /></div>
            <button className="btn btn-primary" type="submit">Sign in</button>
            <p className="small" style={{ marginTop: 18 }}>New student? <a href="/login?mode=signup">Create an account</a></p>
          </form>
        )}
      </section>
    </main>
  );
}
