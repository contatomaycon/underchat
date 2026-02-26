INSERT INTO "worker_config_type" ("worker_config_type_id", "type") VALUES
  ('019f41a5-2f8b-7700-9c7b-1f4f7a67f001'::uuid, 'chatbot_working_hours_enabled'),
  ('019f41a5-2f8b-7700-9c7b-1f4f7a67f002'::uuid, 'chatbot_working_hours_rule')
ON CONFLICT ("worker_config_type_id") DO NOTHING;
