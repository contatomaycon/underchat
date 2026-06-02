ALTER TABLE "chat_user" ADD COLUMN "notifications_internal_chat" boolean NOT NULL DEFAULT true;
ALTER TABLE "chat_user" ADD COLUMN "notifications_internal_chat_direct" boolean NOT NULL DEFAULT true;
ALTER TABLE "chat_user" ADD COLUMN "notifications_internal_chat_group" boolean NOT NULL DEFAULT true;
ALTER TABLE "chat_user" ADD COLUMN "notifications_internal_chat_sound" boolean NOT NULL DEFAULT true;
ALTER TABLE "chat_user" ADD COLUMN "notifications_internal_chat_toast" boolean NOT NULL DEFAULT true;
ALTER TABLE "chat_user" ADD COLUMN "notifications_internal_chat_browser" boolean NOT NULL DEFAULT true;
ALTER TABLE "chat_user" ADD COLUMN "notifications_internal_chat_push" boolean NOT NULL DEFAULT true;
