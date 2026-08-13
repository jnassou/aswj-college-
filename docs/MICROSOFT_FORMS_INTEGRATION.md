# Legacy Microsoft Forms → ASWJ College registration

The Student Portal form is the primary registration source. This server-to-server intake is retained for historical receipts, recovery, or an explicitly approved temporary fallback. Power Automate is not needed for normal registration and should remain disabled after the native cutover.

## Processing rules

- The endpoint requires the server-only `MS_FORMS_INGEST_SECRET` in the `x-aswj-forms-secret` header.
- The complete JSON submission is retained in `external_form_submissions`; retries never overwrite it.
- A response identity is unique within its provider and Form: `microsoft_forms + formId + responseId`.
- Email matching uses the submitted **Email Address**, trimmed and lower-cased. Processing continues only when exactly one existing Student Portal profile with role `student` matches.
- The import never creates a Supabase Auth user or a standalone profile.
- Course matching uses only the protected exact-mapping registry. There is no fuzzy match, first-class fallback or mapping to the test class.
- A valid match creates one `pending` application with source `microsoft_forms` only when the linked class is active, explicitly accepting Portal applications and inside its registration window. Acceptance, waitlisting, declining, enrolment and notifications continue through the existing Applications workflow.
- The existing `(student_id, class_id)` database constraint prevents duplicate applications. A second response for the same student and class is held for administrator review and linked to the existing application.
- Missing, invalid, unmatched or failed submissions remain available under **Admin → Registration Setup**. An administrator can link a course to a real class and reprocess it.
- Guardian, wellbeing, medical, learning, allergy and previous-study details stay in the protected intake record. They are loaded into the browser only when an authenticated administrator opens one submission for review.

## Confirmed workbook fields

The parser uses these confirmed Microsoft Forms workbook labels:

- `Id` (also accepts canonical `responseId` / `Response Id`)
- `Start time`
- `Completion time`
- `Email`
- `Name`
- `Language`
- `Student First Name`
- `Student Last Name`
- `Date of Birth`
- `Select Course`
- `Guardian Full Name (For Kids Class Only)`
- `Guardian Phone Number (For Kids Class Only)`
- `List medical conditions, learning considerations or allergies that could impact the students well being.`
- `Email Address`
- `Phone Number (Will be added to Whatsapp Group)`
- `Any Previous Studies (Please list)`

Guardian and wellbeing answers may be blank when they do not apply. First name, last name, DOB, email, phone, course and completion time are required for automatic processing.

## Exact supported course labels

These labels are pre-registered with no class assigned:

- `Brothers Shariah Level 1 Wednesday Evening`
- `Brothers Shariah Level 3 Wednesday Evening`
- `Sisters Shariah Level 1 Thursday Morning`
- `Sisters Shariah Level 2 Thursday Morning`
- `Sisters Shariah Level 3 Wednesday Evening`

The parenthesised workbook variants, such as `Brothers Shariah Level 1 (Wednesday Evening)`, are canonicalised to the corresponding label above. These migrations do not create class rows because capacity, term dates, teachers and locations have not been confirmed. Create each real class with its known settings in **Admin → Classes**, enable Portal applications only when it is ready, then link it under **Admin → Registration Setup**.

## Optional legacy Power Automate flow

Do not create or enable this flow for the native Student Portal registration path. These steps are retained only if ASWJ deliberately activates the legacy fallback.

1. Trigger: Microsoft Forms — **When a new response is submitted**.
2. Action: Microsoft Forms — **Get response details**.
3. Action: HTTP — `POST https://aswj-college.vercel.app/api/integrations/microsoft-forms`.
4. Headers:
   - `Content-Type: application/json`
   - `x-aswj-forms-secret: <same value as MS_FORMS_INGEST_SECRET>`
5. Enable **Secure Inputs** and **Secure Outputs** on the HTTP action so the secret and sensitive registration answers are hidden from normal run-history views.
6. Send the Form ID and response ID at the top level, and place the confirmed labels under `answers` exactly as shown below.

```json
{
  "formId": "FORM_ID_FROM_THE_TRIGGER",
  "responseId": "RESPONSE_ID_FROM_THE_TRIGGER",
  "answers": {
    "Start time": "2026-08-13T08:55:00.000Z",
    "Completion time": "2026-08-13T09:00:00.000Z",
    "Email": "respondent@example.com",
    "Name": "Respondent Name",
    "Language": "en-AU",
    "Student First Name": "Student",
    "Student Last Name": "Name",
    "Date of Birth": "2000-01-31",
    "Select Course": "Brothers Shariah Level 1 (Wednesday Evening)",
    "Guardian Full Name (For Kids Class Only)": "",
    "Guardian Phone Number (For Kids Class Only)": "",
    "List medical conditions, learning considerations or allergies that could impact the students well being.": "",
    "Email Address": "student@example.com",
    "Phone Number (Will be added to Whatsapp Group)": "0400000000",
    "Any Previous Studies (Please list)": ""
  }
}
```

Use Power Automate date-format expressions so:

- `Date of Birth` is sent as `yyyy-MM-dd`.
- `Completion time` (and `Start time`, when included) is sent as ISO 8601 with a timezone, such as `2026-08-13T09:00:00.000Z`.

Do not send locale-only dates such as `13/08/2026`; the integration deliberately refuses to guess ambiguous dates or timezones.

## Deployment sequence

1. Apply every pending Supabase migration in filename order.
2. Add `SUPABASE_SERVICE_ROLE_KEY`, `MS_FORMS_INGEST_SECRET` and preferably `MS_FORMS_FORM_ID` to the Vercel Production environment. None may use a `NEXT_PUBLIC_` prefix.
3. Redeploy the application so the server receives those environment variables.
4. Create the real class records with confirmed operational details, enable Portal applications when ready, and link each exact course under **Admin → Registration Setup**.
5. Keep the Power Automate flow disabled while configuring it.
6. Submit one controlled response and confirm one immutable intake record and, when profile and course mapping match, one pending application.
7. Replay the same response ID. Confirm the original receipt time/payload remain unchanged and no second application is created.
8. Enable the flow only for an approved fallback period, then disable it again after recovery.

The endpoint returns `201` for an automatically created pending application, `202` when the safely stored response needs review, and `200` for an idempotent retry.
