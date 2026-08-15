# Native ASWJ College registration

The ASWJ Student Portal form is the primary registration path. It does not require Microsoft Forms or Power Automate.

## Student flow

1. Open `/apply`.
2. Create a Student Portal account or sign in with an existing account.
3. Confirm the email address when Supabase email confirmation is enabled.
4. Open **Apply for a class** in the Student Portal.
5. Choose an available class and submit the form once.
6. Follow the pending application and its outcome in the Student Portal.

The submitted email is always taken from the confirmed signed-in account. The browser submits the selected class ID, but the database independently verifies that the class is active, enabled for Portal applications and inside its registration window. The browser cannot choose a student ID, application status or source.

## Administrator setup

For each real class:

1. Create the real class under **Admin → Classes** using confirmed capacity and schedule details.
2. Enable **Allow Student Portal applications** only when registration is ready. The class appears automatically as a Student Portal choice; no separate mapping is required.
3. Optionally set registration open and close times. The form enforces them again at submission time.
4. Test with one confirmed student account. Confirm exactly one pending record appears in both the Student Portal and **Admin → Applications**.
5. Open the Admin review modal and verify the protected submitted details load only on demand.
6. Submit the same class again and confirm the existing application remains unchanged.

New and duplicated classes start with `registration_enabled` set to false, so they are not exposed until an administrator deliberately enables them. Class IDs, rather than names, keep classes distinct even when names are similar or duplicated.

## Microsoft cutover

- Keep the Power Automate flow disabled for the native registration launch.
- Retain **Legacy Forms** and existing Microsoft receipts until every unresolved legacy import is handled.
- `MS_FORMS_INGEST_SECRET` and `MS_FORMS_FORM_ID` are needed only if the legacy webhook is deliberately used.
- `SUPABASE_SERVICE_ROLE_KEY` remains server-only and is optional for the protected legacy Microsoft Forms review tooling. Native class choices do not require this key. It must never use a `NEXT_PUBLIC_` prefix.

## Remaining operational controls

Before a broad public campaign, enable Supabase Auth CAPTCHA, confirm email verification and Auth rate limits, configure the password-recovery URL, and approve a retention/deletion period for application wellbeing information.
