-- Modify "chat_user" table
ALTER TABLE "chat_user" ADD COLUMN "sort_by_chat_order" character varying(50) NULL, ADD COLUMN "sort_by_my_chats_order" character varying(50) NULL, ADD COLUMN "sort_by_queue_order" character varying(50) NULL, ADD COLUMN "sort_by_chatbot_order" character varying(50) NULL;
