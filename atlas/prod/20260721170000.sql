-- Enforce tenant ownership at the database boundary. Add the new constraint
-- without blocking ordinary writes for a full-table validation, validate it,
-- and only then remove the legacy worker-only key.
DELETE FROM "contact_channel" AS "cc"
WHERE NOT EXISTS (
  SELECT 1
  FROM "worker" AS "w"
  WHERE "w"."account_id" = "cc"."account_id"
    AND "w"."worker_id" = "cc"."channel_id"
    AND "w"."deleted_at" IS NULL
);

ALTER TABLE "contact_channel"
  ADD CONSTRAINT "contact_channel_account_channel_fkey"
  FOREIGN KEY ("account_id", "channel_id")
  REFERENCES "worker" ("account_id", "worker_id")
  ON DELETE RESTRICT
  NOT VALID;

ALTER TABLE "contact_channel"
  VALIDATE CONSTRAINT "contact_channel_account_channel_fkey";

ALTER TABLE "contact_channel"
  DROP CONSTRAINT "contact_channel_channel_id_worker_worker_id_fk";
