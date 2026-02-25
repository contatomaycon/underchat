INSERT INTO "worker_config_type" ("worker_config_type_id", "type") VALUES
  ('019e1f3a-1a2b-7c3d-8e4f-5a6b7c8d9e0f'::uuid, 'mark_as_read')
ON CONFLICT ("worker_config_type_id") DO NOTHING;