-- Ensure one external customer mapping per user
DROP INDEX IF EXISTS "user_customer_user_id_idx";

CREATE UNIQUE INDEX "user_customer_user_id_unique_idx"
  ON "user_customer" ("user_id");

-- Re-apply release status domain after 20260331011921 dropped it
ALTER TABLE "account_payment"
  DROP CONSTRAINT IF EXISTS "account_payment_release_status_check";

ALTER TABLE "account_payment"
  ADD CONSTRAINT "account_payment_release_status_check"
  CHECK (
    "release_status" IS NULL
    OR "release_status" IN ('pending', 'processed', 'failed')
  );
