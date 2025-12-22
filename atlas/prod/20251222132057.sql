-- Create "plan_account_exclusive" table
CREATE TABLE "plan_account_exclusive" (
  "plan_account_exclusive_id" uuid NOT NULL,
  "plan_id" uuid NOT NULL,
  "account_id" uuid NOT NULL,
  "created_at" timestamptz NULL DEFAULT now(),
  "updated_at" timestamptz NULL DEFAULT now(),
  PRIMARY KEY ("plan_account_exclusive_id"),
  CONSTRAINT "plan_account_exclusive_account_id_account_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "account" ("account_id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "plan_account_exclusive_plan_id_plan_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "plan" ("plan_id") ON UPDATE NO ACTION ON DELETE NO ACTION
);
