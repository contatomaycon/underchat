-- Create "ai_agent_prompt" table
CREATE TABLE "ai_agent_prompt" (
  "ai_agent_prompt_id" uuid NOT NULL,
  "ai_agent_id" uuid NOT NULL,
  "ai_agent_prompt_type" character varying(20) NOT NULL,
  "name" character varying(200) NOT NULL,
  "value" text NOT NULL,
  "status" character varying(20) NOT NULL DEFAULT 'active',
  "created_at" timestamptz NULL DEFAULT now(),
  "updated_at" timestamptz NULL DEFAULT now(),
  PRIMARY KEY ("ai_agent_prompt_id"),
  CONSTRAINT "ai_agent_prompt_ai_agent_id_ai_agent_ai_agent_id_fk" FOREIGN KEY ("ai_agent_id") REFERENCES "ai_agent" ("ai_agent_id") ON UPDATE NO ACTION ON DELETE NO ACTION
);