-- Create "message_status" table
CREATE TABLE "message_status" (
  "message_status_id" uuid NOT NULL,
  "name" character varying(20) NOT NULL,
  "created_at" timestamptz NULL DEFAULT now(),
  "updated_at" timestamptz NULL DEFAULT now(),
  PRIMARY KEY ("message_status_id")
);
-- Create "message_template" table
CREATE TABLE "message_template" (
  "message_template_id" uuid NOT NULL,
  "account_id" uuid NOT NULL,
  "message_status_id" uuid NOT NULL,
  "command" character varying(100) NOT NULL,
  "message" text NOT NULL,
  "created_at" timestamptz NULL DEFAULT now(),
  "updated_at" timestamptz NULL DEFAULT now(),
  "deleted_at" timestamptz NULL,
  PRIMARY KEY ("message_template_id"),
  CONSTRAINT "message_template_account_id_account_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "account" ("account_id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "message_template_message_status_id_message_status_message_statu" FOREIGN KEY ("message_status_id") REFERENCES "message_status" ("message_status_id") ON UPDATE NO ACTION ON DELETE NO ACTION
);
