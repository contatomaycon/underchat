INSERT INTO "worker_config_type" ("worker_config_type_id", "type") VALUES
  ('01a12c40-5a6b-7c8d-9e0f-112233445566'::uuid, 'typing_simulation')
ON CONFLICT ("worker_config_type_id") DO NOTHING;

WITH missing_workers AS (
  SELECT w."worker_id"
  FROM "worker" w
  WHERE w."deleted_at" IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM "worker_config" wc
      WHERE wc."worker_id" = w."worker_id"
        AND wc."worker_config_type_id" = '01a12c40-5a6b-7c8d-9e0f-112233445566'::uuid
    )
)
INSERT INTO "worker_config" (
  "worker_config_id",
  "worker_id",
  "worker_config_status_id",
  "worker_config_type_id",
  "value",
  "chatbot_id"
)
SELECT
  gen_random_uuid(),
  mw."worker_id",
  '019b89ac-4cd6-7583-a7f0-9dc4631b7edc'::uuid,
  '01a12c40-5a6b-7c8d-9e0f-112233445566'::uuid,
  '50',
  NULL
FROM missing_workers mw;
