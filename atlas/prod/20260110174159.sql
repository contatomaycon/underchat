-- Modify "chat_user" table - Add advanced sorting fields
ALTER TABLE "chat_user" ADD COLUMN "sort_in_chat_order" character varying(10) NULL;
ALTER TABLE "chat_user" ADD COLUMN "sort_my_chats_order" character varying(10) NULL;
ALTER TABLE "chat_user" ADD COLUMN "sort_queue_order" character varying(10) NULL;
ALTER TABLE "chat_user" ADD COLUMN "sort_chatbot_order" character varying(10) NULL;