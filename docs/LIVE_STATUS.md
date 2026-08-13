# ASWJ College live status — v0.7

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
- Immutable Microsoft Forms intake with exact field parsing and response-id deduplication
- Existing-student email matching without automatic Auth-user creation
- Exact Forms course registry with no fallback to the test class
- Protected Forms import review, class assignment and reprocessing workflow

## First admin bootstrap
Create an account through `/login?mode=signup`. After the user confirms the account,
promote that exact Auth user to `super_admin` using a trusted server/admin operation.
Do not expose an open "claim admin" endpoint.

## Environment
Local source control contains only the environment template. Browser values use the public Supabase URL/publishable key; service-role and Forms secrets remain server-only deployment values.

## Microsoft Forms
The ingestion and review implementation is complete. Before enabling Power Automate, add the server-only deployment values, create/link the five real classes using confirmed operational details, redeploy, and run the controlled-response checks in `docs/MICROSOFT_FORMS_INTEGRATION.md`.
