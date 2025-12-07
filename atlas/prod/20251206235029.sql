-- Create "account_test" table
CREATE TABLE "account_test" (
  "account_test_id" uuid NOT NULL,
  "document" character varying(500) NOT NULL,
  "phone" character varying(50) NOT NULL,
  "email" character varying(255) NOT NULL,
  "created_at" timestamptz NULL DEFAULT now(),
  "updated_at" timestamptz NULL DEFAULT now(),
  PRIMARY KEY ("account_test_id")
);