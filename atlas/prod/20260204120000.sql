-- Modify "ai_agent" table
ALTER TABLE "ai_agent" ADD COLUMN "enable_human_transfer_by_prompt" boolean NULL DEFAULT false;
