-- Add release processing controls to account_payment
ALTER TABLE "account_payment"
  ADD COLUMN "release_status" character varying(20) NULL,
  ADD COLUMN "release_processed_at" timestamptz NULL,
  ADD COLUMN "release_last_error" character varying(1000) NULL;

ALTER TABLE "account_payment"
  ADD CONSTRAINT "account_payment_release_status_check"
  CHECK (
    "release_status" IS NULL
    OR "release_status" IN ('pending', 'processed', 'failed')
  );

ALTER TABLE "account_payment"
  ALTER COLUMN "release_status" SET DEFAULT 'pending';

-- Prevent duplicate external payment ids
CREATE UNIQUE INDEX "account_payment_billing_unique_idx" ON "account_payment" ("billing");

-- Monitoring and retry query optimization
CREATE INDEX "account_payment_release_status_created_at_idx" ON "account_payment" ("release_status", "created_at");
