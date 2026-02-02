-- Modify "ai_agent" table
ALTER TABLE "ai_agent" ADD COLUMN "system_prompt" text NULL;
-- Modify "ai_agent_prompt" table
ALTER TABLE "ai_agent_prompt" DROP COLUMN "ai_agent_prompt_type", DROP COLUMN "name";
