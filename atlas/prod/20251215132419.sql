-- Create "scheduled_contact" table
CREATE TABLE "scheduled_contact" (
  "scheduled_contact_id" uuid NOT NULL,
  "contact_group_id" uuid NULL,
  "contact_id" uuid NULL,
  "created_at" timestamptz NULL DEFAULT now(),
  "updated_at" timestamptz NULL DEFAULT now(),
  PRIMARY KEY ("scheduled_contact_id"),
  CONSTRAINT "scheduled_contact_contact_group_id_contact_group_contact_group_" FOREIGN KEY ("contact_group_id") REFERENCES "contact_group" ("contact_group_id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "scheduled_contact_contact_id_contact_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "contact" ("contact_id") ON UPDATE NO ACTION ON DELETE NO ACTION
);
-- Create "schedule" table
CREATE TABLE "schedule" (
  "schedule_id" uuid NOT NULL,
  "account_id" uuid NOT NULL,
  "worker_id" uuid NOT NULL,
  "scheduled_contact_id" uuid NULL,
  "type" character varying(20) NOT NULL,
  "send_to" character varying(30) NOT NULL,
  "message" text NULL,
  "url" character varying(500) NULL,
  "send_date" timestamptz NOT NULL,
  "created_at" timestamptz NULL DEFAULT now(),
  "updated_at" timestamptz NULL DEFAULT now(),
  PRIMARY KEY ("schedule_id"),
  CONSTRAINT "schedule_account_id_account_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "account" ("account_id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "schedule_scheduled_contact_id_scheduled_contact_scheduled_conta" FOREIGN KEY ("scheduled_contact_id") REFERENCES "scheduled_contact" ("scheduled_contact_id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "schedule_worker_id_worker_worker_id_fk" FOREIGN KEY ("worker_id") REFERENCES "worker" ("worker_id") ON UPDATE NO ACTION ON DELETE NO ACTION
);
