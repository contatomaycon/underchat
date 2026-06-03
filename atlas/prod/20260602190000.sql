ALTER TABLE "chat_user"
  ALTER COLUMN "notifications" SET DEFAULT true,
  ALTER COLUMN "notifications_sound" SET DEFAULT true,
  ALTER COLUMN "notifications_toast" SET DEFAULT true,
  ALTER COLUMN "notifications_browser" SET DEFAULT true,
  ALTER COLUMN "notifications_push" SET DEFAULT true,
  ALTER COLUMN "notifications_status_update" SET DEFAULT true,
  ALTER COLUMN "notifications_status_queue" SET DEFAULT false,
  ALTER COLUMN "notifications_status_in_chat" SET DEFAULT true,
  ALTER COLUMN "notifications_status_chatbot" SET DEFAULT false;

UPDATE "chat_user"
SET
  "notifications" = COALESCE("notifications", true),
  "notifications_sound" = COALESCE("notifications_sound", true),
  "notifications_toast" = COALESCE("notifications_toast", true),
  "notifications_browser" = COALESCE("notifications_browser", true),
  "notifications_push" = COALESCE("notifications_push", true),
  "notifications_status_update" = COALESCE("notifications_status_update", true),
  "notifications_status_queue" = COALESCE("notifications_status_queue", false),
  "notifications_status_in_chat" = COALESCE("notifications_status_in_chat", true),
  "notifications_status_chatbot" = COALESCE("notifications_status_chatbot", false);

ALTER TABLE "chat_user"
  ALTER COLUMN "notifications" SET NOT NULL,
  ALTER COLUMN "notifications_sound" SET NOT NULL,
  ALTER COLUMN "notifications_toast" SET NOT NULL,
  ALTER COLUMN "notifications_browser" SET NOT NULL,
  ALTER COLUMN "notifications_push" SET NOT NULL,
  ALTER COLUMN "notifications_status_update" SET NOT NULL,
  ALTER COLUMN "notifications_status_queue" SET NOT NULL,
  ALTER COLUMN "notifications_status_in_chat" SET NOT NULL,
  ALTER COLUMN "notifications_status_chatbot" SET NOT NULL;

ALTER TABLE "chat_user"
  ADD COLUMN "notifications_message_queue" boolean,
  ADD COLUMN "notifications_message_in_chat" boolean,
  ADD COLUMN "notifications_message_chatbot" boolean,
  ADD COLUMN "notifications_transfer" boolean;

UPDATE "chat_user"
SET
  "notifications_message_queue" = COALESCE("notifications_message_queue", "notifications_status_queue", false),
  "notifications_message_in_chat" = COALESCE("notifications_message_in_chat", "notifications_status_in_chat", true),
  "notifications_message_chatbot" = COALESCE("notifications_message_chatbot", "notifications_status_chatbot", false),
  "notifications_transfer" = COALESCE("notifications_transfer", "notifications_status_in_chat", true);

ALTER TABLE "chat_user"
  ALTER COLUMN "notifications_message_queue" SET DEFAULT false,
  ALTER COLUMN "notifications_message_queue" SET NOT NULL,
  ALTER COLUMN "notifications_message_in_chat" SET DEFAULT true,
  ALTER COLUMN "notifications_message_in_chat" SET NOT NULL,
  ALTER COLUMN "notifications_message_chatbot" SET DEFAULT false,
  ALTER COLUMN "notifications_message_chatbot" SET NOT NULL,
  ALTER COLUMN "notifications_transfer" SET DEFAULT true,
  ALTER COLUMN "notifications_transfer" SET NOT NULL;
