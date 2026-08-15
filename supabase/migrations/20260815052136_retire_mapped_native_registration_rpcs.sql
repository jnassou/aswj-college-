-- Run after the class-ID application UI is live. These are the retired native
-- endpoints that depended on the Microsoft Forms course mapping table. Legacy
-- Microsoft Forms ingestion and reprocessing functions remain unchanged.

revoke all on function public.student_registration_options()
from public, anon, authenticated, service_role;

revoke all on function private.student_registration_options_v1()
from public, anon, authenticated, service_role;

revoke all on function public.student_submit_registration(
  text, text, text, date, text, text, text, text, text, boolean, text
)
from public, anon, authenticated, service_role;

revoke all on function private.student_submit_registration_v1(
  text, text, text, date, text, text, text, text, text, boolean, text
)
from public, anon, authenticated, service_role;

comment on function public.student_registration_options() is
  'Retired native registration endpoint retained only for migration history.';
comment on function public.student_submit_registration(
  text, text, text, date, text, text, text, text, text, boolean, text
) is
  'Retired native registration endpoint retained only for migration history.';
