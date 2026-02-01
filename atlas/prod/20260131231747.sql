-- Create "ai_agent_usage" table
CREATE TABLE "ai_agent_usage" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "ai_agent_id" uuid NOT NULL,
  "account_id" uuid NULL,
  "chat_id" character varying(500) NULL,
  "prompt_tokens" integer NULL,
  "completion_tokens" integer NULL,
  "total_tokens" integer NULL,
  "model" character varying(100) NULL,
  "latency_ms" integer NULL,
  "success" boolean NULL,
  "request_type" character varying(50) NULL,
  "created_at" timestamptz NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "ai_agent_usage_ai_agent_id_ai_agent_ai_agent_id_fk" FOREIGN KEY ("ai_agent_id") REFERENCES "ai_agent" ("ai_agent_id") ON UPDATE NO ACTION ON DELETE NO ACTION
);
-- Create index "ai_agent_usage_account_id_idx" to table: "ai_agent_usage"
CREATE INDEX "ai_agent_usage_account_id_idx" ON "ai_agent_usage" ("account_id");
-- Create index "ai_agent_usage_ai_agent_id_created_at_idx" to table: "ai_agent_usage"
CREATE INDEX "ai_agent_usage_ai_agent_id_created_at_idx" ON "ai_agent_usage" ("ai_agent_id", "created_at");
-- Create index "ai_agent_usage_ai_agent_id_idx" to table: "ai_agent_usage"
CREATE INDEX "ai_agent_usage_ai_agent_id_idx" ON "ai_agent_usage" ("ai_agent_id");
-- Create index "ai_agent_usage_created_at_idx" to table: "ai_agent_usage"
CREATE INDEX "ai_agent_usage_created_at_idx" ON "ai_agent_usage" ("created_at");
