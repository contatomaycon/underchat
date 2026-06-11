ALTER TABLE "worker" ADD COLUMN IF NOT EXISTS "recreate_available_at" timestamptz NULL;
