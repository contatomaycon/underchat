-- atlas:txmode file

-- Enforce one canonical config row per worker and config type, except for
-- chatbot working-hours rules, which are intentionally a multi-row config.
-- Retain the most recently updated invalid duplicate before installing the
-- partial database invariant.
LOCK TABLE "worker_config" IN SHARE ROW EXCLUSIVE MODE;

WITH ranked AS (
  SELECT
    "worker_config_id",
    ROW_NUMBER() OVER (
      PARTITION BY "worker_id", "worker_config_type_id"
      ORDER BY
        "updated_at" DESC NULLS LAST,
        "created_at" DESC NULLS LAST,
        "worker_config_id" DESC
    ) AS row_number
  FROM "worker_config"
  WHERE "worker_config_type_id" <> '019f41a5-2f8b-7700-9c7b-1f4f7a67f002'::uuid
)
DELETE FROM "worker_config" target
USING ranked
WHERE target."worker_config_id" = ranked."worker_config_id"
  AND ranked.row_number > 1;

CREATE UNIQUE INDEX "worker_config_worker_id_worker_config_type_id_uidx"
  ON "worker_config" ("worker_id", "worker_config_type_id")
  WHERE "worker_config_type_id" <> '019f41a5-2f8b-7700-9c7b-1f4f7a67f002'::uuid;
