-- Retire orphaned official-connection rows before adding the active-phone
-- uniqueness invariant. Their workers were already soft-deleted, so these
-- connections must not reserve a Meta phone-number asset indefinitely.
UPDATE "public"."worker_whatsapp_official_connection" AS connection
SET
  "deleted_at" = NOW(),
  "updated_at" = NOW()
FROM "public"."worker" AS worker
WHERE connection."worker_id" = worker."worker_id"
  AND connection."deleted_at" IS NULL
  AND worker."deleted_at" IS NOT NULL;
