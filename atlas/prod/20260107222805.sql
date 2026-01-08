-- Modify "ai_agent" table
ALTER TABLE "ai_agent" ADD COLUMN "embedding_model" character varying(100) NULL;
-- Create index "ai_agent_embedding_model_idx" to table: "ai_agent"
CREATE INDEX "ai_agent_embedding_model_idx" ON "ai_agent" ("embedding_model");
-- Create index "ai_agent_model_idx" to table: "ai_agent"
CREATE INDEX "ai_agent_model_idx" ON "ai_agent" ("model");
