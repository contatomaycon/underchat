-- Create "contact" table
CREATE TABLE "contact" (
  "contact_id" uuid NOT NULL,
  "account_id" uuid NULL,
  "label_template_id" uuid NULL,
  "name" character varying(100) NOT NULL,
  "last_name" character varying(100) NULL,
  "email" character varying(500) NULL,
  "email_partial" character varying(50) NULL,
  "email_c" character varying(500) NULL,
  "phone_ddi" character varying(5) NULL,
  "phone" character varying(500) NULL,
  "phone_partial" character varying(15) NULL,
  "phone_c" character varying(500) NULL,
  "nickname" character varying(100) NULL,
  "birthday" timestamptz NULL,
  "notes" text NULL,
  "created_at" timestamptz NULL DEFAULT now(),
  "updated_at" timestamptz NULL DEFAULT now(),
  "deleted_at" timestamptz NULL,
  PRIMARY KEY ("contact_id"),
  CONSTRAINT "contact_account_id_account_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "account" ("account_id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "contact_label_template_id_label_template_label_template_id_fk" FOREIGN KEY ("label_template_id") REFERENCES "label_template" ("label_template_id") ON UPDATE NO ACTION ON DELETE NO ACTION
);
-- Create "contact_group" table
CREATE TABLE "contact_group" (
  "contact_group_id" uuid NOT NULL,
  "account_id" uuid NOT NULL,
  "name" character varying(100) NOT NULL,
  "description" text NULL,
  "created_at" timestamptz NULL DEFAULT now(),
  "updated_at" timestamptz NULL DEFAULT now(),
  "deleted_at" timestamptz NULL,
  PRIMARY KEY ("contact_group_id"),
  CONSTRAINT "contact_group_account_id_account_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "account" ("account_id") ON UPDATE NO ACTION ON DELETE NO ACTION
);
-- Create "contact_group_assignment" table
CREATE TABLE "contact_group_assignment" (
  "contact_group_assignment_id" uuid NOT NULL,
  "contact_id" uuid NOT NULL,
  "contact_group_id" uuid NOT NULL,
  "created_at" timestamptz NULL DEFAULT now(),
  PRIMARY KEY ("contact_group_assignment_id"),
  CONSTRAINT "contact_group_assignment_contact_group_id_contact_group_contact" FOREIGN KEY ("contact_group_id") REFERENCES "contact_group" ("contact_group_id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "contact_group_assignment_contact_id_contact_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "contact" ("contact_id") ON UPDATE NO ACTION ON DELETE NO ACTION
);
