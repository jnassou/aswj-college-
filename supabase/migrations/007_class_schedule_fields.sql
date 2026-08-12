alter table public.classes
  add column if not exists day_of_week smallint,
  add column if not exists start_time time,
  add column if not exists end_time time;

alter table public.classes
  drop constraint if exists classes_day_of_week_check;

alter table public.classes
  add constraint classes_day_of_week_check
  check (day_of_week is null or day_of_week between 0 and 6);

alter table public.classes
  drop constraint if exists classes_time_order_check;

alter table public.classes
  add constraint classes_time_order_check
  check (start_time is null or end_time is null or end_time > start_time);
