# ASWJ College App v0.5

# ASWJ College application — v0.4

Two connected interfaces are being built:

- **ASWJ College Admin** — applications, classes, waitlists, attendance, QR check-in, three-absence reviews, suspension/reinstatement, notifications and audit history.
- **ASWJ College Student Portal** — registration status, classes, QR identity, attendance, warnings and notifications.

## v0.4 changes

- Supabase-backed application list and attendance-review loaders.
- Real Accept / Waitlist / Decline Server Actions when Supabase is configured.
- Real Suspend / Excuse / Keep Enrolled actions when Supabase is configured.
- Admin login using Supabase Auth.
- Next.js 16 `proxy.ts` session refresh path.
- RLS hardening migration using `app_metadata.role` for authorization.
- Attendance review view changed to `security_invoker`.
- Privileged review-generation function removed from public RPC access.
- Microsoft Forms ingestion remains server-only through the service-role key and a shared integration secret.
- Demo fallback remains available when Supabase environment variables are absent.

## Quick local preview

Open `preview.html` directly in a browser to inspect the interface without installing packages.

## Live setup

See `docs/SUPABASE_SETUP.md` and `docs/MICROSOFT_FORMS_INTEGRATION.md`.


## Live connection
This package is configured with the project URL and publishable key in `.env.local`. See `docs/LIVE_STATUS.md`.
