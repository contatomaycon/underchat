-- Create "method_payment" table
CREATE TABLE "method_payment" (
  "method_payment_id" uuid NOT NULL,
  "type" character varying(20) NOT NULL DEFAULT 'boleto',
  "status" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NULL DEFAULT now(),
  "updated_at" timestamptz NULL DEFAULT now(),
  PRIMARY KEY ("method_payment_id")
);
-- Create index "method_payment_created_at_idx" to table: "method_payment"
CREATE INDEX "method_payment_created_at_idx" ON "method_payment" ("created_at");
-- Create index "method_payment_status_idx" to table: "method_payment"
CREATE INDEX "method_payment_status_idx" ON "method_payment" ("status");
-- Create index "method_payment_type_idx" to table: "method_payment"
CREATE INDEX "method_payment_type_idx" ON "method_payment" ("type");
