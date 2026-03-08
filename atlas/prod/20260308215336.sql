-- Modify "worker_config" table
ALTER TABLE "worker_config" DROP CONSTRAINT "worker_config_ai_agent_id_fkey", ADD CONSTRAINT "worker_config_ai_agent_id_ai_agent_ai_agent_id_fk" FOREIGN KEY ("ai_agent_id") REFERENCES "ai_agent" ("ai_agent_id") ON UPDATE NO ACTION ON DELETE NO ACTION;
