CREATE TABLE IF NOT EXISTS "worker_warm_pool" (
  "warm_pool_id" uuid PRIMARY KEY NOT NULL,
  "server_id" uuid NOT NULL REFERENCES "server"("server_id"),
  "worker_type_id" uuid NOT NULL REFERENCES "worker_type"("worker_type_id"),
  "container_id" varchar(100),
  "container_name" varchar(150),
  "session_volume_name" varchar(150) NOT NULL,
  "state" varchar(20) DEFAULT 'warming' NOT NULL,
  "reserved_by_worker_id" uuid REFERENCES "worker"("worker_id"),
  "reservation_expires_at" timestamptz,
  "last_health_at" timestamptz,
  "last_error" varchar(1000),
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "worker_warm_pool_server_type_state_idx"
  ON "worker_warm_pool" ("server_id", "worker_type_id", "state");
CREATE INDEX IF NOT EXISTS "worker_warm_pool_reserved_by_worker_id_idx"
  ON "worker_warm_pool" ("reserved_by_worker_id");
CREATE INDEX IF NOT EXISTS "worker_warm_pool_reservation_expires_at_idx"
  ON "worker_warm_pool" ("reservation_expires_at");
CREATE INDEX IF NOT EXISTS "worker_warm_pool_container_id_idx"
  ON "worker_warm_pool" ("container_id");
CREATE INDEX IF NOT EXISTS "worker_warm_pool_container_name_idx"
  ON "worker_warm_pool" ("container_name");

CREATE TABLE IF NOT EXISTS "worker_runtime" (
  "worker_id" uuid PRIMARY KEY NOT NULL REFERENCES "worker"("worker_id"),
  "container_id" varchar(100),
  "container_name" varchar(150),
  "session_volume_name" varchar(150) NOT NULL,
  "runtime_generation" integer DEFAULT 1 NOT NULL,
  "warm_pool_id" uuid REFERENCES "worker_warm_pool"("warm_pool_id"),
  "activated_at" timestamptz,
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "worker_runtime_container_id_idx"
  ON "worker_runtime" ("container_id");
CREATE INDEX IF NOT EXISTS "worker_runtime_container_name_idx"
  ON "worker_runtime" ("container_name");
CREATE INDEX IF NOT EXISTS "worker_runtime_session_volume_name_idx"
  ON "worker_runtime" ("session_volume_name");
CREATE INDEX IF NOT EXISTS "worker_runtime_warm_pool_id_idx"
  ON "worker_runtime" ("warm_pool_id");

INSERT INTO "worker_runtime" (
  "worker_id",
  "container_id",
  "container_name",
  "session_volume_name",
  "runtime_generation",
  "activated_at",
  "created_at",
  "updated_at"
)
SELECT
  "worker_id",
  "container_id",
  "worker_id"::text,
  "worker_id"::text,
  1,
  COALESCE("updated_at", now()),
  COALESCE("created_at", now()),
  now()
FROM "worker"
WHERE "deleted_at" IS NULL
ON CONFLICT ("worker_id") DO NOTHING;
