-- Add active WhatsApp validation metadata.
ALTER TABLE "two_factor"
  ALTER COLUMN "code" TYPE character varying(64),
  ADD COLUMN "worker_id" uuid NULL,
  ADD COLUMN "worker_number" character varying(20) NULL,
  ADD COLUMN "validation_context" character varying(30) NULL,
  ADD COLUMN "validated_at" timestamptz NULL;

CREATE INDEX "two_factor_worker_id_idx" ON "two_factor" ("worker_id");
CREATE INDEX "two_factor_validation_context_idx" ON "two_factor" ("validation_context");
CREATE INDEX "two_factor_validated_at_idx" ON "two_factor" ("validated_at");

ALTER TABLE "account_test"
  ADD COLUMN "status" character varying(20) NOT NULL DEFAULT 'created';

CREATE INDEX "account_test_status_idx" ON "account_test" ("status");
