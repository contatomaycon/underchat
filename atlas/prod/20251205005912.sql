-- Create "notifications" table
CREATE TABLE "notifications" (
  "notification_id" uuid NOT NULL,
  "two_factor_notification" uuid NOT NULL,
  "plan_notification" uuid NOT NULL,
  "plan_expiration_reminder" uuid NOT NULL,
  "created_at" timestamptz NULL DEFAULT now(),
  "updated_at" timestamptz NULL DEFAULT now(),
  "deleted_at" timestamptz NULL,
  PRIMARY KEY ("notification_id"),
  CONSTRAINT "notifications_plan_expiration_reminder_worker_worker_id_fk" FOREIGN KEY ("plan_expiration_reminder") REFERENCES "worker" ("worker_id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "notifications_plan_notification_worker_worker_id_fk" FOREIGN KEY ("plan_notification") REFERENCES "worker" ("worker_id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "notifications_two_factor_notification_worker_worker_id_fk" FOREIGN KEY ("two_factor_notification") REFERENCES "worker" ("worker_id") ON UPDATE NO ACTION ON DELETE NO ACTION
);
