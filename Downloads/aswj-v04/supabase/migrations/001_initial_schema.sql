create extension if not exists pgcrypto;

create type application_status as enum ('pending','accepted','waitlisted','declined','withdrawn');
create type enrolment_status as enum ('enrolled','waitlisted','suspended','withdrawn','completed');
create type attendance_status as enum ('present','late','absent_unexcused','absent_excused','cancelled');
create type user_role as enum ('student','teacher','admin','super_admin');

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role user_role not null default 'student',
  first_name text not null,
  last_name text not null,
  email text,
  mobile text,
  date_of_birth date,
  emergency_contact_name text,
  emergency_contact_mobile text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table classes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  term text,
  teacher_id uuid references profiles(id),
  location text,
  capacity integer not null check (capacity > 0),
  absence_threshold integer not null default 3 check (absence_threshold > 0),
  registration_opens_at timestamptz,
  registration_closes_at timestamptz,
  starts_on date,
  ends_on date,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table applications (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references profiles(id),
  class_id uuid not null references classes(id),
  status application_status not null default 'pending',
  waitlist_position integer,
  source text not null default 'student_portal',
  external_response_id text,
  submitted_at timestamptz not null default now(),
  reviewed_by uuid references profiles(id),
  reviewed_at timestamptz,
  admin_notes text,
  unique(student_id, class_id)
);

create table enrolments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references profiles(id),
  class_id uuid not null references classes(id),
  application_id uuid references applications(id),
  status enrolment_status not null default 'enrolled',
  enrolled_at timestamptz not null default now(),
  suspended_at timestamptz,
  suspension_reason text,
  suspended_by uuid references profiles(id),
  reinstated_at timestamptz,
  reinstated_by uuid references profiles(id),
  unique(student_id, class_id)
);

create table class_sessions (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references classes(id) on delete cascade,
  session_date date not null,
  starts_at timestamptz,
  ends_at timestamptz,
  cancelled boolean not null default false,
  unique(class_id, session_date)
);

create table attendance (
  id uuid primary key default gen_random_uuid(),
  enrolment_id uuid not null references enrolments(id) on delete cascade,
  session_id uuid not null references class_sessions(id) on delete cascade,
  status attendance_status not null,
  checked_in_at timestamptz,
  checkin_method text,
  recorded_by uuid references profiles(id),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(enrolment_id, session_id)
);

create table suspension_reviews (
  id uuid primary key default gen_random_uuid(),
  enrolment_id uuid not null references enrolments(id) on delete cascade,
  triggered_at timestamptz not null default now(),
  consecutive_absences integer not null,
  status text not null default 'open' check (status in ('open','suspended','excused','corrected','kept_enrolled','closed')),
  reviewed_by uuid references profiles(id),
  reviewed_at timestamptz,
  review_note text
);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references profiles(id),
  enrolment_id uuid references enrolments(id),
  channel text not null check (channel in ('email','sms','portal')),
  template_key text not null,
  status text not null default 'queued',
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create table audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references profiles(id),
  entity_type text not null,
  entity_id text not null,
  action text not null,
  old_values jsonb,
  new_values jsonb,
  created_at timestamptz not null default now()
);

-- QR identities are opaque random tokens; never encode personal information directly in QR values.
create table student_qr_tokens (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references profiles(id) on delete cascade,
  token uuid not null default gen_random_uuid() unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

-- View used by the ASWJ College Admin attendance-review dashboard.
-- A streak is counted backwards from the most recent completed, non-cancelled class session
-- and ends at the first record that is anything other than an unexcused absence.
create view students_requiring_attendance_review as
with ordered as (
  select
    e.id as enrolment_id,
    e.student_id,
    e.class_id,
    cs.session_date,
    a.status,
    row_number() over (partition by e.id order by cs.session_date desc) rn
  from enrolments e
  join class_sessions cs
    on cs.class_id = e.class_id
   and cs.cancelled = false
   and cs.session_date <= current_date
  left join attendance a
    on a.enrolment_id = e.id
   and a.session_id = cs.id
  where e.status = 'enrolled'
), first_break as (
  select
    enrolment_id,
    min(rn) filter (where status is distinct from 'absent_unexcused'::attendance_status) as break_rn
  from ordered
  group by enrolment_id
), streaks as (
  select
    o.enrolment_id,
    count(*) filter (
      where o.status = 'absent_unexcused'
        and o.rn < coalesce(b.break_rn, 2147483647)
    ) as consecutive_absences
  from ordered o
  join first_break b using (enrolment_id)
  group by o.enrolment_id
)
select
  e.id as enrolment_id,
  e.student_id,
  e.class_id,
  s.consecutive_absences,
  c.absence_threshold
from streaks s
join enrolments e on e.id = s.enrolment_id
join classes c on c.id = e.class_id
where s.consecutive_absences >= c.absence_threshold;

-- RLS baseline. Detailed role policies should be added before production.
alter table profiles enable row level security;
alter table classes enable row level security;
alter table applications enable row level security;
alter table enrolments enable row level security;
alter table class_sessions enable row level security;
alter table attendance enable row level security;
alter table suspension_reviews enable row level security;
alter table notifications enable row level security;
alter table student_qr_tokens enable row level security;
