INSERT INTO "worker_config_type" ("worker_config_type_id", "type") VALUES
  ('01a0f0f1-1b2c-7d3e-8f90-1234567890ab'::uuid, 'attendance_inactivity_alert')
ON CONFLICT ("worker_config_type_id") DO NOTHING;
