import Image from 'next/image';
import { REGISTRATION_COURSES } from '../../lib/registration-courses';
import { createSupabaseServerClient, hasSupabaseConfig } from '../../lib/supabase/server';

export const metadata = {
  title: 'Apply | ASWJ College',
  description: 'Apply for an ASWJ College class through the Student Portal.',
};

export default async function ApplyLandingPage() {
  let user: { app_metadata?: Record<string, unknown> } | null = null;

  if (hasSupabaseConfig()) {
    const supabase = await createSupabaseServerClient();
    const result = await supabase.auth.getUser();
    user = result.data.user;
  }

  const role = String(user?.app_metadata?.role ?? 'student');
  const isStudent = Boolean(user) && role === 'student';
  const portalHref = ['admin', 'super_admin'].includes(role) ? '/admin' : '/student';

  return (
    <main className="login-shell">
      <section className="login-card" style={{ width: 'min(760px, 100%)' }}>
        <Image
          className="login-logo"
          src="/aswj-logo.png"
          alt="ASWJ Islamic College"
          width={650}
          height={390}
          priority
        />

        <span className="small">ASWJ College registration</span>
        <h1 style={{ marginBottom: 8 }}>Apply for a class</h1>
        <p className="subtitle" style={{ lineHeight: 1.55 }}>
          Class applications now begin in the Student Portal. Sign in with your confirmed
          email address, or create a student account before completing the application form.
        </p>

        <div className="card" style={{ marginTop: 22 }}>
          <strong>How it works</strong>
          <ol style={{ lineHeight: 1.7, paddingLeft: 22, marginBottom: 0 }}>
            <li>Create or sign in to your Student Portal account.</li>
            <li>Choose an available course and submit your registration details.</li>
            <li>Track the pending application and its outcome in the portal.</li>
          </ol>
        </div>

        <div className="actions" style={{ marginTop: 22 }}>
          {isStudent ? (
            <>
              <a className="btn btn-primary" href="/student/apply">Continue to application</a>
              <a className="btn btn-outline" href="/student">Student Portal</a>
            </>
          ) : user ? (
            <a className="btn btn-primary" href={portalHref}>Open your portal</a>
          ) : (
            <>
              <a className="btn btn-primary" href="/login?next=%2Fstudent%2Fapply">Sign in and apply</a>
              <a className="btn btn-outline" href="/login?mode=signup&amp;next=%2Fstudent%2Fapply">Create student account</a>
            </>
          )}
        </div>

        <section style={{ marginTop: 28 }} aria-labelledby="available-courses-heading">
          <h2 id="available-courses-heading" style={{ fontSize: 18 }}>Supported courses</h2>
          <p className="small">
            Availability and confirmed class details are shown after you sign in.
          </p>
          <ul style={{ lineHeight: 1.65, paddingLeft: 22 }}>
            {REGISTRATION_COURSES.map((course) => <li key={course}>{course}</li>)}
          </ul>
        </section>
      </section>
    </main>
  );
}
