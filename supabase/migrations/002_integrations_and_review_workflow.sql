-- External form intake is deliberately separated from student/application records.
-- This lets ASWJ College keep using Microsoft Forms while mappings are reviewed and changed safely.
create table external_form_submissions (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  external_form_id text,
  external_response_id text not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processing_status text not null default 'pending'
    check (processing_status in ('pending','processed','needs_review','failed')),
  processed_at timestamptz,
  processing_note text,
  application_id uuid references applications(id),
  unique(provider, external_response_id)
);

alter table external_form_submissions enable row level security;

-- Create one open review per enrolment when it first reaches its configured absence threshold.
create unique index if not exists one_open_suspension_review_per_enrolment
  on suspension_reviews(enrolment_id) where status = 'open';

create or replace function create_missing_suspension_reviews()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_count integer;
begin
  insert into suspension_reviews (enrolment_id, consecutive_absences)
  select r.enrolment_id, r.consecutive_absences
  from students_requiring_attendance_review r
  where not exists (
    select 1 from suspension_reviews sr
    where sr.enrolment_id = r.enrolment_id and sr.status = 'open'
  );
  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

-- Useful indexes for the most common dashboard queries.
create index if not exists attendance_enrolment_session_idx on attendance(enrolment_id, session_id);
create index if not exists applications_class_status_idx on applications(class_id, status);
create index if not exists enrolments_class_status_idx on enrolments(class_id, status);
create index if not exists sessions_class_date_idx on class_sessions(class_id, session_date desc);
create index if not exists notifications_status_created_idx on notifications(status, created_at);
