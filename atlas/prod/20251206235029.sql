-- Create "account_test" table
CREATE TABLE "account_test" (
  "account_test_id" uuid NOT NULL,
  "document" character varying(500) NOT NULL,
  "document_c" character varying(500) NOT NULL,
  "phone" character varying(500) NOT NULL,
  "phone_c" character varying(500) NOT NULL,
  "email" character varying(500) NOT NULL,
  "email_c" character varying(500) NOT NULL,
  "created_at" timestamptz NULL DEFAULT now(),
  "updated_at" timestamptz NULL DEFAULT now(),
  PRIMARY KEY ("account_test_id")
);