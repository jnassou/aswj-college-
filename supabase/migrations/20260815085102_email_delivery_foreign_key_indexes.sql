create index if not exists email_deliveries_notification_idx
  on private.email_deliveries (notification_id)
  where notification_id is not null;

create index if not exists email_deliveries_application_idx
  on private.email_deliveries (application_id)
  where application_id is not null;

create index if not exists email_deliveries_enrolment_idx
  on private.email_deliveries (enrolment_id)
  where enrolment_id is not null;
