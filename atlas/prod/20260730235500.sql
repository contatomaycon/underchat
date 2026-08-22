-- Durable, replay-safe journal for bulk channel recreation requests.
CREATE TABLE "config_channels_recreate_batch" (
  "config_channels_recreate_batch_id" uuid NOT NULL,
  "request_id" uuid NOT NULL,
  "source_topic" character varying(255) NOT NULL,
  "source_partition" integer NOT NULL,
  "source_offset" bigint NOT NULL,
  "account_id" uuid NOT NULL,
  "filters" jsonb NOT NULL,
  "status" character varying(20) NOT NULL DEFAULT 'queued',
  "total_count" integer NOT NULL DEFAULT 0,
  "success_count" integer NOT NULL DEFAULT 0,
  "error_count" integer NOT NULL DEFAULT 0,
  "last_error" text NULL,
  "completion_lease_owner" uuid NULL,
  "completion_lease_expires_at" timestamptz NULL,
  "completion_attempt_count" integer NOT NULL DEFAULT 0,
  "next_completion_attempt_at" timestamptz NOT NULL DEFAULT now(),
  "completion_published_at" timestamptz NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "started_at" timestamptz NULL,
  "finished_at" timestamptz NULL,
  PRIMARY KEY ("config_channels_recreate_batch_id"),
  CONSTRAINT "config_channels_recreate_batch_counts_nonnegative_check"
    CHECK (
      "total_count" >= 0
      AND "success_count" >= 0
      AND "error_count" >= 0
    ),
  CONSTRAINT "config_recreate_batch_completion_attempt_nonnegative_ck"
    CHECK ("completion_attempt_count" >= 0),
  CONSTRAINT "config_channels_recreate_batch_status_check"
    CHECK ("status" IN ('queued', 'running', 'completed'))
);

CREATE UNIQUE INDEX "config_channels_recreate_batch_request_id_uq"
  ON "config_channels_recreate_batch" ("request_id");
CREATE UNIQUE INDEX "config_channels_recreate_batch_source_uq"
  ON "config_channels_recreate_batch"
  ("source_topic", "source_partition", "source_offset");
CREATE INDEX "config_channels_recreate_batch_status_idx"
  ON "config_channels_recreate_batch" ("status");
CREATE INDEX "config_channels_recreate_batch_completion_claim_idx"
  ON "config_channels_recreate_batch"
  (
    "next_completion_attempt_at",
    "completion_lease_expires_at",
    "finished_at"
  )
  WHERE "status" = 'completed' AND "completion_published_at" IS NULL;

CREATE TABLE "config_channels_recreate_target" (
  "config_channels_recreate_target_id" uuid NOT NULL,
  "config_channels_recreate_batch_id" uuid NOT NULL,
  "worker_id" uuid NOT NULL,
  "worker_account_id" uuid NOT NULL,
  "server_id" uuid NOT NULL,
  "worker_type_id" uuid NOT NULL,
  "lifecycle_operation_id" uuid NOT NULL,
  "lifecycle_journal" jsonb NULL,
  "attempt_baseline_operation_id" uuid NULL,
  "attempt_baseline_worker_status_id" uuid NULL,
  "attempt_baseline_worker_container_id" character varying(100) NULL,
  "attempt_baseline_runtime_exists" boolean NULL,
  "attempt_baseline_runtime_container_id" character varying(100) NULL,
  "attempt_baseline_runtime_generation" integer NULL,
  "attempt_baseline_captured_at" timestamptz NULL,
  "initial_worker_status_id" uuid NOT NULL,
  "initial_worker_container_id" character varying(100) NULL,
  "initial_runtime_container_id" character varying(100) NULL,
  "initial_runtime_generation" integer NULL,
  "status" character varying(20) NOT NULL DEFAULT 'pending',
  "attempt_count" integer NOT NULL DEFAULT 0,
  "next_attempt_at" timestamptz NOT NULL DEFAULT now(),
  "lease_owner" uuid NULL,
  "lease_expires_at" timestamptz NULL,
  "recreate_server_slot_key" character varying(500) NULL,
  "recreate_server_slot_token" character varying(500) NULL,
  "recreate_server_slot_index" integer NULL,
  "last_error" text NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "started_at" timestamptz NULL,
  "enqueued_at" timestamptz NULL,
  "finished_at" timestamptz NULL,
  PRIMARY KEY ("config_channels_recreate_target_id"),
  CONSTRAINT "config_channels_recreate_target_batch_fk"
    FOREIGN KEY ("config_channels_recreate_batch_id")
    REFERENCES "config_channels_recreate_batch"
    ("config_channels_recreate_batch_id")
    ON DELETE CASCADE,
  CONSTRAINT "config_channels_recreate_target_attempt_nonnegative_check"
    CHECK ("attempt_count" >= 0),
  CONSTRAINT "config_channels_recreate_target_status_check"
    CHECK (
      "status" IN (
        'pending',
        'processing',
        'enqueued',
        'succeeded',
        'failed'
      )
    ),
  CONSTRAINT "config_channels_recreate_target_generation_nonnegative_check"
    CHECK (
      "initial_runtime_generation" IS NULL
      OR "initial_runtime_generation" >= 0
    ),
  CONSTRAINT "config_recreate_target_attempt_baseline_generation_ck"
    CHECK (
      "attempt_baseline_runtime_generation" IS NULL
      OR "attempt_baseline_runtime_generation" >= 0
    ),
  CONSTRAINT "config_recreate_target_attempt_baseline_consistency_ck"
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
    ),
  CONSTRAINT "config_channels_recreate_target_slot_index_nonnegative_check"
    CHECK (
      "recreate_server_slot_index" IS NULL
      OR "recreate_server_slot_index" >= 0
    )
);

CREATE UNIQUE INDEX "config_channels_recreate_target_batch_worker_uq"
  ON "config_channels_recreate_target"
  ("config_channels_recreate_batch_id", "worker_id");
CREATE INDEX "config_channels_recreate_target_batch_status_idx"
  ON "config_channels_recreate_target"
  ("config_channels_recreate_batch_id", "status");
CREATE INDEX "config_channels_recreate_target_pending_claim_idx"
  ON "config_channels_recreate_target"
  (
    "next_attempt_at",
    "created_at",
    "config_channels_recreate_target_id"
  )
  WHERE "status" = 'pending';
CREATE INDEX "config_channels_recreate_target_leased_claim_idx"
  ON "config_channels_recreate_target"
  (
    "next_attempt_at",
    "lease_expires_at",
    "created_at",
    "config_channels_recreate_target_id"
  )
  WHERE "status" IN ('processing', 'enqueued');
CREATE INDEX "config_channels_recreate_target_server_status_idx"
  ON "config_channels_recreate_target" ("server_id", "status");
