# ASWJ College live status — v0.6

Supabase project is connected and the production schema is deployed.

## Live
- Students / profiles
- Classes and class sessions
- Applications: pending, accepted, waitlisted, declined
- Enrolments: enrolled, waitlisted, suspended, withdrawn, completed
- Attendance: present, late, unexcused absent, excused absent, cancelled
- Consecutive-unexcused-absence review view with per-class threshold (default 3)
- Suspension review records
- Notifications queue
- Audit log
- Random student QR identity tokens
- RLS-based admin/student access controls
- Automatic profile + QR creation on Supabase Auth signup
- Student application and enrolment status views
- Per-class attendance history and consecutive-absence standing
- Portal notification feed with student-scoped read acknowledgement
- Automatic warning/review notifications with 14-day duplicate suppression
- Sydney-local attendance calculations based on recorded roll outcomes and bounded by enrolment/reinstatement dates
- Atomic application, suspension, review, reinstatement and check-in workflows
- Internal application notes exposed only through an administrator-authorised database function

## First admin bootstrap
Create an account through `/login?mode=signup`. After the user confirms the account,
promote that exact Auth user to `super_admin` using a trusted server/admin operation.
Do not expose an open "claim admin" endpoint.

## Environment
`.env.local` contains only the Supabase project URL and publishable browser key. Server/secret keys are deliberately not included.

## Microsoft Forms
The ingestion endpoint remains prepared but requires a server-only Supabase secret/service-role key and an `MS_FORMS_INGEST_SECRET` in the deployment environment before enabling the Power Automate flow.
