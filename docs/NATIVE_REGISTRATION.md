# Native ASWJ College registration

The ASWJ Student Portal form is the primary registration path. It does not require Microsoft Forms or Power Automate.

## Student flow

1. Open `/apply`.
2. Create a Student Portal account or sign in with an existing account.
3. Confirm the email address when Supabase email confirmation is enabled.
4. Open **Apply for a class** in the Student Portal.
5. Choose an available course and submit the form once.
6. Follow the pending application and its outcome in the Student Portal.

The submitted email is always taken from the confirmed signed-in account. The browser cannot choose a student ID, class UUID, application status or source.

## Administrator setup

The five supported course labels already exist, but no capacity, teacher, term dates or location is invented by the migration.

For each real course:

1. Create the real class under **Admin → Classes** using confirmed capacity and schedule details.
2. Under **Admin → Registration Setup**, link the exact course label to that class.
3. Return to **Admin → Classes** and enable **Allow Student Portal applications** only when registration is ready.
4. Optionally set registration open and close times. The form and legacy fallback both enforce them at submission time.
5. Test with one confirmed student account. Confirm exactly one pending record appears in both the Student Portal and **Admin → Applications**.
6. Open the Admin review modal and verify the protected submitted details load only on demand.
7. Submit the same course again and confirm the existing application remains unchanged.

The existing test class is not exposed because `registration_enabled` defaults to false and the application accepts only the five exact mapped course labels.

## Microsoft cutover

- Keep the Power Automate flow disabled for the native registration launch.
- Retain **Registration Setup** and existing Microsoft receipts until every unresolved legacy import is handled.
- `MS_FORMS_INGEST_SECRET` and `MS_FORMS_FORM_ID` are needed only if the legacy webhook is deliberately used.
- `SUPABASE_SERVICE_ROLE_KEY` remains server-only and is used by the protected Registration Setup/legacy review tooling. It must never use a `NEXT_PUBLIC_` prefix.

## Remaining operational controls

Before a broad public campaign, enable Supabase Auth CAPTCHA, confirm email verification and Auth rate limits, configure the password-recovery URL, and approve a retention/deletion period for application wellbeing information.
