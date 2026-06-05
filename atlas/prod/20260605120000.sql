CREATE TABLE IF NOT EXISTS "worker_warm_pool_settings" (
  "settings_id" varchar(30) PRIMARY KEY NOT NULL,
  "warmup_enabled" boolean DEFAULT false NOT NULL,
  "target_ready_baileys" integer DEFAULT 2 NOT NULL,
  "target_ready_wwebjs" integer DEFAULT 2 NOT NULL,
  "target_ready_whatsmeow" integer DEFAULT 2 NOT NULL,
  "scan_interval_seconds" integer DEFAULT 30 NOT NULL,
  "reservation_ttl_seconds" integer DEFAULT 90 NOT NULL,
  "warming_stale_after_seconds" integer DEFAULT 180 NOT NULL,
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now(),
  CONSTRAINT "worker_warm_pool_settings_targets_check"
    CHECK (
      "target_ready_baileys" >= 0
      AND "target_ready_wwebjs" >= 0
      AND "target_ready_whatsmeow" >= 0
    ),
  CONSTRAINT "worker_warm_pool_settings_intervals_check"
    CHECK (
      "scan_interval_seconds" >= 5
      AND "reservation_ttl_seconds" >= 10
      AND "warming_stale_after_seconds" >= 30
    )
);
