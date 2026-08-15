# ASWJ College application — v0.8

Two connected interfaces support the college registration and attendance workflow:

- **ASWJ College Admin** — applications, classes, waitlists, attendance, QR check-in, consecutive-absence reviews, suspension/reinstatement, notifications and audit history.
- **ASWJ College Student Portal** — application outcomes, per-class enrolment and attendance status, warnings, notifications and QR identity.

## v0.8 changes

- Native, account-based class application form at `/student/apply`.
- Public `/apply` entry point for student sign-in or account creation.
- Class choices come directly from active classes explicitly enabled under **Admin → Classes**.
- Explicit per-class Portal application switch, defaulting off so test/internal classes are never exposed accidentally.
- Atomic duplicate-safe submission using the authenticated student identity and confirmed Auth email.
- Private application snapshots for guardian, wellbeing, allergy and previous-study answers, loaded only when an administrator opens one application.
- Existing pending review, acceptance, waitlist, enrolment, notification and Student Portal workflows preserved.
- Microsoft Forms ingestion retained only as a protected legacy fallback.

## v0.7 changes

- Immutable Microsoft Forms response intake using the confirmed workbook fields.
- Exact, administrator-controlled mapping for the five real Shariah course labels.
- Existing Student Portal profile matching by normalized email without fabricated Auth users.
- Duplicate response and student/class application protection.
- Protected Forms Imports review, course assignment and reprocessing flow.

## v0.6 changes

- Student application timeline with pending, accepted, waitlisted, declined and withdrawn states.
- Per-class attendance totals, recent session history and configurable absence warnings.
- Student notification inbox with secure read/unread acknowledgement.
- Portal notices for application decisions, warnings, reviews, suspension, excused attendance and reinstatement.
- Sydney-local recorded attendance bounded by enrolment/reinstatement dates, so open rolls and inactive periods do not create false absences.
- Valid automatic review closure after attendance corrections.
- Atomic application, attendance-review and check-in workflows with audit and notification writes in the same transaction.
- Admin review notes protected from student Data API access.
- Preserved enrolment and attendance history when an accepted application outcome changes.
- Restored audit events for QR check-in, manual attendance and roll closure.
- Next.js 16.3.0 with an npm lockfile and production TypeScript configuration.

## Local development

```bash
npm install
npm run dev
```

Run `npm run build` for the production compile and route check.

`preview.html` remains available as a static interface reference. Live application and portal workflows require the Supabase values described in `.env.example`.

## Live setup

See `docs/SUPABASE_SETUP.md`, `docs/LIVE_STATUS.md` and `docs/NATIVE_REGISTRATION.md`.
