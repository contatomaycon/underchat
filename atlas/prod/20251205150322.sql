-- Create "account_payment_cross_sell" table
CREATE TABLE "account_payment_cross_sell" (
  "account_payment_cross_sell_id" uuid NOT NULL,
  "plan_cross_sell_id" uuid NOT NULL,
  "account_payment_id" uuid NOT NULL,
  "quantity" integer NOT NULL,
  "value" numeric(10,2) NOT NULL,
  "created_at" timestamptz NULL DEFAULT now(),
  "updated_at" timestamptz NULL DEFAULT now(),
  PRIMARY KEY ("account_payment_cross_sell_id"),
  CONSTRAINT "account_payment_cross_sell_plan_cross_sell_id_plan_cross_sell_plan_cross_sell_id_fk" FOREIGN KEY ("plan_cross_sell_id") REFERENCES "plan_cross_sell" ("plan_cross_sell_id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "account_payment_cross_sell_account_payment_id_account_payment_account_payment_id_fk" FOREIGN KEY ("account_payment_id") REFERENCES "account_payment" ("account_payment_id") ON UPDATE NO ACTION ON DELETE NO ACTION
);