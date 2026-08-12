# Security notes

- Admin mutations must call `requireAdmin()` and verify the signed-in user has `admin` or `super_admin` role.
- The Supabase service-role key is used only by server-side integration endpoints and must never be exposed in `NEXT_PUBLIC_*` environment variables.
- Microsoft Forms ingestion requires a long random shared secret in the `x-aswj-forms-secret` header.
- QR tokens are opaque random UUIDs; never put student names, phone numbers, email addresses or database profile data directly into a QR code.
- Suspension applies to an enrolment in a class, not the entire student account.
- Every sensitive administrator decision should create an audit-log record.
- Production launch requires complete RLS policies, login screens, password/recovery policy, backups, privacy retention rules, and notification controls.
