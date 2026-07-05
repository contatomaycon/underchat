ALTER TABLE "worker" ALTER COLUMN "server_id" DROP NOT NULL;

UPDATE "worker"
SET
  "server_id" = NULL,
  "last_connection_check_at" = NULL,
  "worker_status_id" = CASE
    WHEN EXISTS (
      SELECT 1
      FROM "worker_whatsapp_official_connection"
      WHERE
        "worker_whatsapp_official_connection"."worker_id" = "worker"."worker_id"
        AND "worker_whatsapp_official_connection"."deleted_at" IS NULL
    )
    THEN '019a930d-c6f6-766d-9c84-30af6ecc33b2'::uuid
    ELSE '019a930d-c6f6-766d-9c84-3696c2cd5ed8'::uuid
  END,
  "updated_at" = now()
WHERE "worker_type_id" = '019a930d-c6f6-766d-9c84-55fe10d25e2c';
