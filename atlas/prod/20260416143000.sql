-- Add granular chat notification preferences to chat_user
ALTER TABLE "chat_user"
  ADD COLUMN "notifications_sound" boolean NOT NULL DEFAULT true,
  ADD COLUMN "notifications_toast" boolean NOT NULL DEFAULT true,
  ADD COLUMN "notifications_browser" boolean NOT NULL DEFAULT true,
  ADD COLUMN "notifications_push" boolean NOT NULL DEFAULT true;
