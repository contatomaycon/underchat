INSERT INTO "worker_config_type" ("worker_config_type_id", "type") VALUES
  ('019e19fd-ec33-7243-ab45-0cedecb5b22d'::uuid, 'security_key'),
  ('019e19fd-ec34-715d-8285-30050fced53a'::uuid, 'security_key_chatbot'),
  ('019e19fd-ec34-715d-8285-379564246120'::uuid, 'security_key_schedule'),
  ('019e19fd-ec34-715d-8285-3aea36167be9'::uuid, 'security_key_quick_message')
ON CONFLICT ("worker_config_type_id") DO NOTHING;

WITH config_types AS (
  SELECT *
  FROM (
    VALUES
      ('019e19fd-ec33-7243-ab45-0cedecb5b22d'::uuid),
      ('019e19fd-ec34-715d-8285-30050fced53a'::uuid),
      ('019e19fd-ec34-715d-8285-379564246120'::uuid),
      ('019e19fd-ec34-715d-8285-3aea36167be9'::uuid)
  ) AS types("worker_config_type_id")
),
missing_worker_configs AS (
  SELECT
    w."worker_id",
    ct."worker_config_type_id"
  FROM "worker" w
  CROSS JOIN config_types ct
  WHERE w."deleted_at" IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM "worker_config" wc
      WHERE wc."worker_id" = w."worker_id"
        AND wc."worker_config_type_id" = ct."worker_config_type_id"
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
  mw."worker_config_type_id",
  NULL,
  NULL
FROM missing_worker_configs mw;