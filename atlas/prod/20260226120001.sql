INSERT INTO "worker_config_type" ("worker_config_type_id", "type")
VALUES
  ('019c9cfa-aba1-7378-bf86-00edd736886e'::uuid, 'show_protocol_in_chat')
ON CONFLICT ("worker_config_type_id") DO NOTHING;