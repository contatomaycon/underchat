-- Insert new chatbot output config type
INSERT INTO "worker_config_type" ("worker_config_type_id", "type") VALUES 
  ('019b89ac-697e-75cb-83a0-37769e49888d'::uuid, 'chatbot_output_id')
ON CONFLICT ("worker_config_type_id") DO NOTHING;