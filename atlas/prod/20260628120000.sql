ALTER TABLE "chat_user"
  ADD COLUMN IF NOT EXISTS "notifications_vibrate" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "notifications_internal_chat_vibrate" boolean NOT NULL DEFAULT false;
