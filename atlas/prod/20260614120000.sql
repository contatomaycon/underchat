ALTER TABLE "chat_user"
  DROP COLUMN IF EXISTS "notifications_status_update",
  DROP COLUMN IF EXISTS "notifications_status_queue",
  DROP COLUMN IF EXISTS "notifications_status_in_chat",
  DROP COLUMN IF EXISTS "notifications_status_chatbot";
