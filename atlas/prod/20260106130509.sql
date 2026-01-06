-- Create "ai_agent_type" table
CREATE TABLE "ai_agent_type" (
  "ai_agent_type_id" uuid NOT NULL,
  "name" character varying(100) NOT NULL,
  "created_at" timestamptz NULL DEFAULT now(),
  "updated_at" timestamptz NULL DEFAULT now(),
  PRIMARY KEY ("ai_agent_type_id")
);

-- Create "ai_agent" table
CREATE TABLE "ai_agent" (
  "ai_agent_id" uuid NOT NULL,
  "account_id" uuid NOT NULL,
  "ai_agent_type_id" uuid NOT NULL,
  "name" character varying(200) NOT NULL,
  "base_url" character varying(500) NULL,
  "api_key" character varying(2000) NULL,
  "status" character varying(20) NOT NULL DEFAULT 'active',
  "created_at" timestamptz NULL DEFAULT now(),
  "updated_at" timestamptz NULL DEFAULT now(),
  PRIMARY KEY ("ai_agent_id"),
  CONSTRAINT "ai_agent_account_id_account_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "account" ("account_id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "ai_agent_ai_agent_type_id_ai_agent_type_ai_agent_type_id_fk" FOREIGN KEY ("ai_agent_type_id") REFERENCES "ai_agent_type" ("ai_agent_type_id") ON UPDATE NO ACTION ON DELETE NO ACTION
);

-- Insert seed "ai_agent_type" table
INSERT INTO "ai_agent_type" ("ai_agent_type_id", "name", "created_at", "updated_at") VALUES 
  ('019b940d-878a-7422-845d-fb86b6ef3612', 'GPT', NOW(), NOW()),
  ('019b940d-878e-760c-b4c3-b8cd27ad67cd', 'Gemini', NOW(), NOW())
ON CONFLICT ("ai_agent_type_id") DO NOTHING;