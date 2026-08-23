'use client';

export default function StudentPortalError({ reset }: { reset: () => void }) {
  return (
    <main id="main-content" className="student-portal" tabIndex={-1}>
      <section className="card portal-error" role="alert" aria-labelledby="portal-error-heading">
        <h1 id="portal-error-heading">We could not load your portal</h1>
        <p className="subtitle">
          Your records have not been changed. Please try again or contact ASWJ College
          administration if the problem continues.
        </p>
        <button className="btn btn-primary" type="button" onClick={reset}>Try again</button>
      </section>
    </main>
  );
}
