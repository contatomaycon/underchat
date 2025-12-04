-- Create "payment_billing_type" table
CREATE TABLE "payment_billing_type" (
  "payment_billing_type_id" uuid NOT NULL,
  "name" character varying(50) NOT NULL,
  "created_at" timestamptz NULL DEFAULT now(),
  "updated_at" timestamptz NULL DEFAULT now(),
  PRIMARY KEY ("payment_billing_type_id")
);
-- Create "payment_status" table
CREATE TABLE "payment_status" (
  "payment_status_id" uuid NOT NULL,
  "name" character varying(50) NOT NULL,
  "created_at" timestamptz NULL DEFAULT now(),
  "updated_at" timestamptz NULL DEFAULT now(),
  PRIMARY KEY ("payment_status_id")
);
-- Create "plan_account_status" table
CREATE TABLE "plan_account_status" (
  "plan_account_status_id" uuid NOT NULL,
  "name" character varying(20) NOT NULL,
  "created_at" timestamptz NULL DEFAULT now(),
  "updated_at" timestamptz NULL DEFAULT now(),
  PRIMARY KEY ("plan_account_status_id")
);
-- Create "plan_account" table
CREATE TABLE "plan_account" (
  "plan_account_id" uuid NOT NULL,
  "account_id" uuid NOT NULL,
  "plan_id" uuid NOT NULL,
  "plan_account_status_id" uuid NOT NULL,
  "recurring_payment" boolean NOT NULL DEFAULT false,
  "last_payment_date" timestamptz NULL,
  "next_payment_date" timestamptz NULL,
  "cancellation_date" timestamptz NULL,
  "created_at" timestamptz NULL DEFAULT now(),
  "updated_at" timestamptz NULL DEFAULT now(),
  PRIMARY KEY ("plan_account_id"),
  CONSTRAINT "plan_account_account_id_account_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "account" ("account_id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "plan_account_plan_account_status_id_plan_account_status_plan_ac" FOREIGN KEY ("plan_account_status_id") REFERENCES "plan_account_status" ("plan_account_status_id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "plan_account_plan_id_plan_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "plan" ("plan_id") ON UPDATE NO ACTION ON DELETE NO ACTION
);
-- Create "user_card" table
CREATE TABLE "user_card" (
  "user_card_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "token" character varying(500) NOT NULL,
  "holder_name" character varying(500) NOT NULL,
  "last_number" character varying(10) NOT NULL,
  "brand" character varying(50) NOT NULL,
  "default" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NULL DEFAULT now(),
  "updated_at" timestamptz NULL DEFAULT now(),
  PRIMARY KEY ("user_card_id"),
  CONSTRAINT "user_card_user_id_user_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user" ("user_id") ON UPDATE NO ACTION ON DELETE NO ACTION
);
-- Create "user_customer" table
CREATE TABLE "user_customer" (
  "user_customer_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "user_customer" character varying(500) NOT NULL,
  "created_at" timestamptz NULL DEFAULT now(),
  "updated_at" timestamptz NULL DEFAULT now(),
  PRIMARY KEY ("user_customer_id"),
  CONSTRAINT "user_customer_user_id_user_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user" ("user_id") ON UPDATE NO ACTION ON DELETE NO ACTION
);

-- Create "billing_period" table
CREATE TABLE "billing_period" (
  "billing_period_id" uuid NOT NULL,
  "name" character varying(20) NOT NULL,
  "created_at" timestamptz NULL DEFAULT now(),
  "updated_at" timestamptz NULL DEFAULT now(),
  PRIMARY KEY ("billing_period_id")
);

-- Create "account_payment" table
CREATE TABLE "account_payment" (
  "account_payment_id" uuid NOT NULL,
  "account_id" uuid NOT NULL,
  "user_customer_id" uuid NOT NULL,
  "plan_account_id" uuid NOT NULL,
  "billing" character varying(500) NOT NULL,
  "payment_billing_type_id" uuid NOT NULL,
  "billing_period_id" uuid NULL,
  "value" numeric(10,2) NOT NULL,
  "net_value" numeric(10,2) NOT NULL,
  "user_card_id" uuid NULL,
  "installment" numeric(10,2) NULL,
  "boleto" character varying(500) NULL,
  "boleto_number" character varying(100) NULL,
  "pix_transaction" character varying(500) NULL,
  "pix_qr_code_id" character varying(500) NULL,
  "payment_status_id" uuid NOT NULL,
  "payment_date" timestamptz NULL,
  "invoice_url" character varying(1000) NULL,
  "created_at" timestamptz NULL DEFAULT now(),
  "updated_at" timestamptz NULL DEFAULT now(),
  PRIMARY KEY ("account_payment_id"),
  CONSTRAINT "account_payment_account_id_account_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "account" ("account_id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "account_payment_payment_billing_type_id_payment_billing_type_pa" FOREIGN KEY ("payment_billing_type_id") REFERENCES "payment_billing_type" ("payment_billing_type_id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "account_payment_payment_status_id_payment_status_payment_status" FOREIGN KEY ("payment_status_id") REFERENCES "payment_status" ("payment_status_id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "account_payment_plan_account_id_plan_account_plan_account_id_fk" FOREIGN KEY ("plan_account_id") REFERENCES "plan_account" ("plan_account_id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "account_payment_user_card_id_user_card_user_card_id_fk" FOREIGN KEY ("user_card_id") REFERENCES "user_card" ("user_card_id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "account_payment_user_customer_id_user_customer_user_customer_id" FOREIGN KEY ("user_customer_id") REFERENCES "user_customer" ("user_customer_id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "account_payment_billing_period_id_billing_period_billing_period_id_fk" FOREIGN KEY ("billing_period_id") REFERENCES "billing_period" ("billing_period_id") ON UPDATE NO ACTION ON DELETE NO ACTION
);
