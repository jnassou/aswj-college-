'use client';

export default function StudentPortalError({ reset }: { reset: () => void }) {
  return (
    <main className="student-portal">
      <section className="card portal-error">
        <h1>We could not load your portal</h1>
        <p className="subtitle">
          Your records have not been changed. Please try again or contact ASWJ College
          administration if the problem continues.
        </p>
        <button className="btn btn-primary" onClick={reset}>Try again</button>
      </section>
    </main>
  );
}
