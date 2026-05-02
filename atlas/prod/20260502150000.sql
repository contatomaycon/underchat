INSERT INTO "worker_config_type" ("worker_config_type_id", "type") VALUES
  ('01a34b50-6c7d-8e9f-a021-334455667788'::uuid, 'operator_reply_pending_alert')
ON CONFLICT ("worker_config_type_id") DO NOTHING;
