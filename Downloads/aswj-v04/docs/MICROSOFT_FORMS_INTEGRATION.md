# Microsoft Forms → ASWJ College integration

The existing Microsoft Form can stay live during the migration.

## Power Automate flow
1. Trigger: Microsoft Forms — **When a new response is submitted**.
2. Action: Microsoft Forms — **Get response details**.
3. Action: HTTP POST to `https://YOUR_APP_DOMAIN/api/integrations/microsoft-forms`.
4. Add request header `x-aswj-forms-secret` with the same secret stored as `MS_FORMS_INGEST_SECRET` in the app.
5. Send a JSON body containing at minimum:
   - `formId`
   - `responseId`
   - the response fields returned by **Get response details**

Example body shape (field names will be mapped after the current form questions are exported/reviewed):

```json
{
  "formId": "your-form-id",
  "responseId": "@{triggerOutputs()?['body/resourceData/responseId']}",
  "answers": {
    "firstName": "...",
    "lastName": "...",
    "email": "...",
    "mobile": "..."
  }
}
```

The endpoint first stores the complete payload in `external_form_submissions`. It does **not** blindly create a student record. This prevents an incorrect field mapping from corrupting the student database.

## Next mapping step
Export one sample response or the form question list. Then map those fields to `profiles` + `applications` and mark each intake row `processed` or `needs_review`.
