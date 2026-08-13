# ASWJ College live status — v0.8

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
- Public Apply entry page and authenticated Student Portal application form
- Exact five-course native application choices with no arbitrary/test-class selection
- Explicit per-class Portal application switch and registration-window enforcement
- Confirmed-account identity, atomic duplicate protection and pending Admin Applications hand-off
- Protected one-to-one native registration details loaded only for an authorised administrator

## First admin bootstrap
Create an account through `/login?mode=signup`. After the user confirms the account,
promote that exact Auth user to `super_admin` using a trusted server/admin operation.
Do not expose an open "claim admin" endpoint.

## Environment
Local source control contains only the environment template. Browser values use the public Supabase URL/publishable key; service-role and Forms secrets remain server-only deployment values.

## Registration cutover
The ASWJ form in the Student Portal is now the primary registration path. Create each real class with confirmed operational details, link the exact application choice under **Admin → Registration Setup**, and explicitly enable Portal applications on the class. Existing Microsoft receipts and reprocessing remain available as a legacy fallback; Power Automate is not required for the native form.
