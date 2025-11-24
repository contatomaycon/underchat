-- Create "expenditure" table
CREATE TABLE "expenditure" (
  "expenditure_id" uuid NOT NULL,
  "name" character varying(200) NOT NULL,
  "description" text NULL,
  "price" numeric(10,2) NOT NULL,
  "created_at" timestamptz NULL DEFAULT now(),
  "updated_at" timestamptz NULL DEFAULT now(),
  "deleted_at" timestamptz NULL,
  PRIMARY KEY ("expenditure_id")
);
