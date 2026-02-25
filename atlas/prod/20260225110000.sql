INSERT INTO "worker_config_type" ("worker_config_type_id", "type") VALUES
  ('019c923a-00fd-7490-9495-e9e72b652713'::uuid, 'attendance_hours'),
  ('019c923a-00ff-72ac-84f5-0a78aa1e864c'::uuid, 'outside_hours_message')
ON CONFLICT ("worker_config_type_id") DO NOTHING;
