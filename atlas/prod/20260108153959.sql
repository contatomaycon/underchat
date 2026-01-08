-- Insert new worker config type for AI Agent
INSERT INTO "worker_config_type" ("worker_config_type_id", "type") VALUES 
  ('019b9ee8-acf5-756c-a56c-b67a2647cec0'::uuid, 'ai_agent')
ON CONFLICT ("worker_config_type_id") DO NOTHING;