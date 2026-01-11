-- Insert seed "ai_agent_type" table
INSERT INTO "ai_agent_type" ("ai_agent_type_id", "name", "created_at", "updated_at") VALUES 
  ('019bae7a-f837-7404-87c0-bef6bdfa061a', 'DeepSeek', NOW(), NOW())
ON CONFLICT ("ai_agent_type_id") DO NOTHING;
