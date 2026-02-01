-- Modify "ai_agent" table
ALTER TABLE "ai_agent" ADD COLUMN "voice_ia_id" uuid NULL, ADD CONSTRAINT "ai_agent_voice_ia_id_voice_ia_voice_ia_id_fk" FOREIGN KEY ("voice_ia_id") REFERENCES "voice_ia" ("voice_ia_id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- Create index "ai_agent_voice_ia_id_idx" to table: "ai_agent"
CREATE INDEX "ai_agent_voice_ia_id_idx" ON "ai_agent" ("voice_ia_id");
