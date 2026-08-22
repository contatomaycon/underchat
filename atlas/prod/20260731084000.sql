-- Complete the durable bulk-recreation schema for databases that already
-- applied the first version of 20260730235500.sql. The column guards also
-- keep this migration safe when the full version was applied on a fresh DB.
ALTER TABLE "config_channels_recreate_batch"
  ADD COLUMN IF NOT EXISTS "completion_attempt_count"
    integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "next_completion_attempt_at"
    timestamptz NOT NULL DEFAULT now();

ALTER TABLE "config_channels_recreate_target"
  ADD COLUMN IF NOT EXISTS "lifecycle_journal" jsonb NULL,
  ADD COLUMN IF NOT EXISTS "attempt_baseline_operation_id" uuid NULL,
  ADD COLUMN IF NOT EXISTS "attempt_baseline_worker_status_id" uuid NULL,
  ADD COLUMN IF NOT EXISTS "attempt_baseline_worker_container_id"
    character varying(100) NULL,
  ADD COLUMN IF NOT EXISTS "attempt_baseline_runtime_exists" boolean NULL,
  ADD COLUMN IF NOT EXISTS "attempt_baseline_runtime_container_id"
    character varying(100) NULL,
  ADD COLUMN IF NOT EXISTS "attempt_baseline_runtime_generation" integer NULL,
  ADD COLUMN IF NOT EXISTS "attempt_baseline_captured_at" timestamptz NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname =
      'config_recreate_batch_completion_attempt_nonnegative_ck'
      AND conrelid = 'config_channels_recreate_batch'::regclass
  ) THEN
    ALTER TABLE "config_channels_recreate_batch"
      ADD CONSTRAINT
        "config_recreate_batch_completion_attempt_nonnegative_ck"
      CHECK ("completion_attempt_count" >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname =
      'config_recreate_target_attempt_baseline_generation_ck'
      AND conrelid = 'config_channels_recreate_target'::regclass
  ) THEN
    ALTER TABLE "config_channels_recreate_target"
      ADD CONSTRAINT
        "config_recreate_target_attempt_baseline_generation_ck"
      CHECK (
        "attempt_baseline_runtime_generation" IS NULL
        OR "attempt_baseline_runtime_generation" >= 0
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname =
      'config_recreate_target_attempt_baseline_consistency_ck'
      AND conrelid = 'config_channels_recreate_target'::regclass
  ) THEN
    ALTER TABLE "config_channels_recreate_target"
      ADD CONSTRAINT
        "config_recreate_target_attempt_baseline_consistency_ck"
      CHECK (
        (
          "attempt_baseline_operation_id" IS NULL
          AND "attempt_baseline_worker_status_id" IS NULL
          AND "attempt_baseline_worker_container_id" IS NULL
          AND "attempt_baseline_runtime_exists" IS NULL
          AND "attempt_baseline_runtime_container_id" IS NULL
          AND "attempt_baseline_runtime_generation" IS NULL
          AND "attempt_baseline_captured_at" IS NULL
        )
        OR (
          "attempt_baseline_operation_id" IS NOT NULL
          AND "attempt_baseline_worker_status_id" IS NOT NULL
          AND "attempt_baseline_runtime_exists" IS NOT NULL
          AND "attempt_baseline_captured_at" IS NOT NULL
          AND (
            (
              "attempt_baseline_runtime_exists" = FALSE
              AND "attempt_baseline_runtime_container_id" IS NULL
              AND "attempt_baseline_runtime_generation" IS NULL
            )
            OR (
              "attempt_baseline_runtime_exists" = TRUE
              AND "attempt_baseline_runtime_generation" IS NOT NULL
            )
          )
        )
      );
  END IF;
END
$$;

-- Rebuild the two claim indexes because their leading columns changed when
-- retry scheduling was added. These tables are new and expected to be small.
DROP INDEX IF EXISTS
  "config_channels_recreate_batch_completion_claim_idx";
CREATE INDEX "config_channels_recreate_batch_completion_claim_idx"
  ON "config_channels_recreate_batch"
  (
    "next_completion_attempt_at",
    "completion_lease_expires_at",
    "finished_at"
  )
  WHERE "status" = 'completed' AND "completion_published_at" IS NULL;

DROP INDEX IF EXISTS
  "config_channels_recreate_target_leased_claim_idx";
CREATE INDEX "config_channels_recreate_target_leased_claim_idx"
  ON "config_channels_recreate_target"
  (
    "next_attempt_at",
    "lease_expires_at",
    "created_at",
    "config_channels_recreate_target_id"
  )
  WHERE "status" IN ('processing', 'enqueued');
