-- Create "label_status" table
CREATE TABLE "label_status" (
  "label_status_id" uuid NOT NULL,
  "name" character varying(20) NOT NULL,
  "created_at" timestamptz NULL DEFAULT now(),
  "updated_at" timestamptz NULL DEFAULT now(),
  PRIMARY KEY ("label_status_id")
);
-- Create "label_template" table
CREATE TABLE "label_template" (
  "label_template_id" uuid NOT NULL,
  "account_id" uuid NOT NULL,
  "label_status_id" uuid NOT NULL,
  "command" character varying(100) NOT NULL,
  "message" text NOT NULL,
  "created_at" timestamptz NULL DEFAULT now(),
  "updated_at" timestamptz NULL DEFAULT now(),
  "deleted_at" timestamptz NULL,
  PRIMARY KEY ("label_template_id"),
  CONSTRAINT "label_template_account_id_account_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "account" ("account_id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "label_template_label_status_id_label_status_label_status_id_fk" FOREIGN KEY ("label_status_id") REFERENCES "label_status" ("label_status_id") ON UPDATE NO ACTION ON DELETE NO ACTION
);
