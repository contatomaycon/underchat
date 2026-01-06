-- Insert "Others" seed in "ai_agent_type" table
INSERT INTO "ai_agent_type" ("ai_agent_type_id", "name", "created_at", "updated_at") VALUES
  ('019b940d-8790-7a1e-9c5d-8f2e3a4b5c6d', 'Others', NOW(), NOW())
ON CONFLICT ("ai_agent_type_id") DO NOTHING;
