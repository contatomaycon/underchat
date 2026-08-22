INSERT INTO "worker_config_type" ("worker_config_type_id", "type") VALUES
  (
    '019f9c22-9857-724f-921b-06d3eca98337'::uuid,
    'operator_reply_pending_redistribution'
  )
ON CONFLICT ("worker_config_type_id") DO NOTHING;
