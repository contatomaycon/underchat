-- Add chatbot_id column to worker_config table
ALTER TABLE "worker_config" ADD COLUMN "chatbot_id" uuid NULL;

-- Add foreign key constraint
ALTER TABLE "worker_config" ADD CONSTRAINT "worker_config_chatbot_id_chatbot_chatbot_id_fk" FOREIGN KEY ("chatbot_id") REFERENCES "chatbot" ("chatbot_id") ON UPDATE NO ACTION ON DELETE NO ACTION;

