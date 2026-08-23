import Image from 'next/image';
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
    <main id="main-content" className="public-shell" tabIndex={-1}>
      <div className="public-layout">
        <section className="public-brand-panel" aria-label="ASWJ Islamic College">
          <div className="public-logo-panel">
            <Image
              className="public-logo"
              src="/aswj-logo.png"
              alt="ASWJ Islamic College"
              width={650}
              height={390}
              priority
            />
          </div>
          <div className="public-brand-copy">
            <span className="eyebrow eyebrow-on-dark">Student registration</span>
            <p className="public-brand-title">A clear path from application to enrolment.</p>
            <p>
              Apply securely, follow your application status and keep your class information
              together in one Student Portal.
            </p>
          </div>
        </section>

        <section className="public-content-panel" aria-labelledby="application-heading">
          <div className="public-intro">
            <span className="eyebrow">ASWJ College registration</span>
            <h1 id="application-heading">Apply for a class</h1>
            <p className="subtitle public-lead">
              Class applications begin in the Student Portal. Sign in with your confirmed
              email address, or create a student account before completing the application form.
            </p>
          </div>

          <section className="public-steps" aria-labelledby="how-it-works-heading">
            <h2 id="how-it-works-heading">How it works</h2>
            <ol className="public-step-list">
              <li className="public-step">
                <span className="public-step-number" aria-hidden="true">1</span>
                <div>
                  <strong>Create or sign in</strong>
                  <span>Use your confirmed email address to enter the Student Portal.</span>
                </div>
              </li>
              <li className="public-step">
                <span className="public-step-number" aria-hidden="true">2</span>
                <div>
                  <strong>Choose an available class</strong>
                  <span>Review its confirmed day, time and location before applying.</span>
                </div>
              </li>
              <li className="public-step">
                <span className="public-step-number" aria-hidden="true">3</span>
                <div>
                  <strong>Follow your application</strong>
                  <span>Track the pending application and its outcome in your portal.</span>
                </div>
              </li>
            </ol>
          </section>

          <div className="actions public-actions">
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

          <aside className="public-availability-note" aria-labelledby="available-classes-heading">
            <span className="public-note-mark" aria-hidden="true" />
            <div>
              <h2 id="available-classes-heading">Current class choices</h2>
              <p>
                Available classes and their confirmed schedules are shown after you sign in.
                The list is managed directly by ASWJ College administration.
              </p>
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}
