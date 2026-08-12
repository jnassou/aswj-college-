# ASWJ College application — v0.6

Two connected interfaces support the college registration and attendance workflow:

- **ASWJ College Admin** — applications, classes, waitlists, attendance, QR check-in, consecutive-absence reviews, suspension/reinstatement, notifications and audit history.
- **ASWJ College Student Portal** — application outcomes, per-class enrolment and attendance status, warnings, notifications and QR identity.

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

See `docs/SUPABASE_SETUP.md`, `docs/LIVE_STATUS.md` and `docs/MICROSOFT_FORMS_INTEGRATION.md`.
