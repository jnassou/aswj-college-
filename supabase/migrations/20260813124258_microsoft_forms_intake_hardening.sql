-- Keep the private Microsoft Forms intake efficient for foreign-key checks and
-- explicitly deny direct browser/API access even if table grants change later.

create index if not exists external_form_submissions_application_idx
on public.external_form_submissions (application_id);

create index if not exists external_form_course_mappings_class_idx
on public.external_form_course_mappings (class_id);

drop policy if exists external_form_submissions_no_client_access
on public.external_form_submissions;
create policy external_form_submissions_no_client_access
on public.external_form_submissions
for all
to anon, authenticated
using (false)
with check (false);

drop policy if exists external_form_course_mappings_no_client_access
on public.external_form_course_mappings;
create policy external_form_course_mappings_no_client_access
on public.external_form_course_mappings
for all
to anon, authenticated
using (false)
with check (false);
