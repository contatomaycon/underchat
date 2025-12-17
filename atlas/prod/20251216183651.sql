-- Create "two_factor" table
CREATE TABLE "two_factor" (
  "two_factor_id" uuid NOT NULL,
  "user_id" uuid NULL,
  "phone_ddi" character varying(5) NULL,
  "phone" character varying(500) NULL,
  "phone_partial" character varying(15) NULL,
  "phone_c" character varying(500) NULL,
  "email" character varying(500) NULL,
  "email_partial" character varying(50) NULL,
  "email_c" character varying(500) NULL,
  "code" character varying(8) NOT NULL,
  "token" character varying(255) NOT NULL,
  "created_at" timestamptz NULL DEFAULT now(),
  "updated_at" timestamptz NULL DEFAULT now(),
  "deleted_at" timestamptz NULL,
  PRIMARY KEY ("two_factor_id"),
  CONSTRAINT "two_factor_user_id_user_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user" ("user_id") ON UPDATE NO ACTION ON DELETE NO ACTION
);
