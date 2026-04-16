ALTER TABLE "chat_user"
  ADD COLUMN "notifications_status_update" boolean NOT NULL DEFAULT true,
  ADD COLUMN "notifications_status_queue" boolean NOT NULL DEFAULT false,
  ADD COLUMN "notifications_status_in_chat" boolean NOT NULL DEFAULT true;
