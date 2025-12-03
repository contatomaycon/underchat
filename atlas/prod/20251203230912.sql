-- Insert seed "plan_account_status" table
INSERT INTO "plan_account_status" ("plan_account_status_id", "name", "created_at", "updated_at") VALUES 
  ('019a930d-c6f4-75ad-88ff-9a1b2c3d4e5a', 'active', NOW(), NOW()),
  ('019a930d-c6f4-75ad-88ff-9b2c3d4e5f6b', 'inactive', NOW(), NOW())
ON CONFLICT ("plan_account_status_id") DO NOTHING;

