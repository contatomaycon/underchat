-- Create "account_payment_nfse_status" table
CREATE TABLE "account_payment_nfse_status" (
  "account_payment_nfse_status_id" uuid NOT NULL,
  "name" character varying(50) NOT NULL,
  "created_at" timestamptz NULL DEFAULT now(),
  "updated_at" timestamptz NULL DEFAULT now(),
  PRIMARY KEY ("account_payment_nfse_status_id")
);
-- Create "nfse" table
CREATE TABLE "nfse" (
  "nfse_id" uuid NOT NULL,
  "external_id" integer NULL,
  "name" character varying(500) NOT NULL,
  "municipal_service_description_field" character varying(500) NULL,
  "municipal_service_code" character varying(50) NULL,
  "retain_iss" boolean NOT NULL DEFAULT false,
  "iss_value" numeric(10,5) NULL,
  "cofins_value" numeric(10,5) NULL,
  "csll_value" numeric(10,5) NULL,
  "inss_value" numeric(10,5) NULL,
  "ir_value" numeric(10,5) NULL,
  "pis_value" numeric(10,5) NULL,
  "deductions" numeric(10,5) NULL,
  "default_product" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NULL DEFAULT now(),
  "updated_at" timestamptz NULL DEFAULT now(),
  PRIMARY KEY ("nfse_id")
);
-- Create "account_payment_nfse" table
CREATE TABLE "account_payment_nfse" (
  "account_payment_nfse_id" uuid NOT NULL,
  "account_payment_id" uuid NOT NULL,
  "nfse_id" uuid NOT NULL,
  "reference" character varying(100) NOT NULL,
  "account_payment_nfse_status_id" uuid NOT NULL,
  "type" character varying(50) NULL,
  "status_description" character varying(500) NULL,
  "pdf_url" character varying(1000) NULL,
  "xml_url" character varying(1000) NULL,
  "rps_serie" character varying(50) NULL,
  "number" character varying(100) NULL,
  "validation_code" character varying(200) NULL,
  "value" numeric(10,2) NOT NULL,
  "created_at" timestamptz NULL DEFAULT now(),
  "updated_at" timestamptz NULL DEFAULT now(),
  PRIMARY KEY ("account_payment_nfse_id"),
  CONSTRAINT "account_payment_nfse_account_payment_id_account_payment_account_payment_id_fk" FOREIGN KEY ("account_payment_id") REFERENCES "account_payment" ("account_payment_id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "account_payment_nfse_account_payment_nfse_status_id_account_payment_nfse_status_account_payment_nfse_status_id_fk" FOREIGN KEY ("account_payment_nfse_status_id") REFERENCES "account_payment_nfse_status" ("account_payment_nfse_status_id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "account_payment_nfse_nfse_id_nfse_nfse_id_fk" FOREIGN KEY ("nfse_id") REFERENCES "nfse" ("nfse_id") ON UPDATE NO ACTION ON DELETE NO ACTION
);

