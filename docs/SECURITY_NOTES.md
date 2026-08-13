# Security notes

- Admin mutations must call `requireAdmin()` and verify the signed-in user has `admin` or `super_admin` role.
- The Supabase service-role key is used only by server-side integration endpoints and must never be exposed in `NEXT_PUBLIC_*` environment variables.
- Microsoft Forms ingestion requires a long random shared secret in the `x-aswj-forms-secret` header.
- Native registration derives identity from the confirmed signed-in Auth user and never accepts a submitted student ID, application status or arbitrary class UUID.
- Guardian, medical, learning, allergy and previous-study answers are stored outside profiles and ordinary application lists. They are loaded only through an administrator-authorised detail function.
- Students cannot insert directly into `applications` or change the Auth-owned email through the public profiles endpoint.
- Open account creation should use Supabase CAPTCHA and production Auth rate limits before a broad public campaign.
- QR tokens are opaque random UUIDs; never put student names, phone numbers, email addresses or database profile data directly into a QR code.
- Suspension applies to an enrolment in a class, not the entire student account.
- Every sensitive administrator decision should create an audit-log record.
- Production launch requires password/recovery policy, backups, a documented privacy-retention/deletion schedule, and notification controls.
