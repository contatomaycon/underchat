-- Insert seed "notification_type" table
INSERT INTO "notification_type" ("notification_type_id", "name", "created_at", "updated_at") VALUES 
  ('019b8636-2555-774c-a3e3-db0296fef619', 'TEST_PLAN_NEW', NOW(), NOW()),
  ('019b8636-2556-7341-bd6e-7714c9158286', 'TEST_PLAN_EXPIRATION', NOW(), NOW())
ON CONFLICT ("notification_type_id") DO NOTHING;