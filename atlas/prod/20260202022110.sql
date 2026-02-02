-- Modify "ai_agent" table
ALTER TABLE "ai_agent" ADD COLUMN "enable_human_transfer" boolean NULL DEFAULT false;
-- Create "ai_agent_human_transfer_target" table
CREATE TABLE "ai_agent_human_transfer_target" (
  "ai_agent_human_transfer_target_id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "ai_agent_id" uuid NOT NULL,
  "account_id" uuid NOT NULL,
  "target_type" character varying(20) NOT NULL,
  "sector_id" uuid NULL,
  "user_id" uuid NULL,
  "created_at" timestamptz NULL DEFAULT now(),
  PRIMARY KEY ("ai_agent_human_transfer_target_id"),
  CONSTRAINT "ai_agent_human_transfer_target_account_id_account_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "account" ("account_id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "ai_agent_human_transfer_target_ai_agent_id_ai_agent_ai_agent_id" FOREIGN KEY ("ai_agent_id") REFERENCES "ai_agent" ("ai_agent_id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "ai_agent_human_transfer_target_sector_id_sector_sector_id_fk" FOREIGN KEY ("sector_id") REFERENCES "sector" ("sector_id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "ai_agent_human_transfer_target_user_id_user_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user" ("user_id") ON UPDATE NO ACTION ON DELETE CASCADE
);
-- Create index "ai_agent_human_transfer_target_account_id_idx" to table: "ai_agent_human_transfer_target"
CREATE INDEX "ai_agent_human_transfer_target_account_id_idx" ON "ai_agent_human_transfer_target" ("account_id");
-- Create index "ai_agent_human_transfer_target_ai_agent_id_account_id_idx" to table: "ai_agent_human_transfer_target"
CREATE INDEX "ai_agent_human_transfer_target_ai_agent_id_account_id_idx" ON "ai_agent_human_transfer_target" ("ai_agent_id", "account_id");
-- Create index "ai_agent_human_transfer_target_ai_agent_id_idx" to table: "ai_agent_human_transfer_target"
CREATE INDEX "ai_agent_human_transfer_target_ai_agent_id_idx" ON "ai_agent_human_transfer_target" ("ai_agent_id");
