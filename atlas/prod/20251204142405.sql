-- Insert seed "billing_period" table
INSERT INTO "billing_period" ("billing_period_id", "name", "created_at", "updated_at") VALUES 
  ('019a930d-c6f4-75ad-88ff-9a1b2c3d4e6a', 'monthly', NOW(), NOW()),
  ('019a930d-c6f4-75ad-88ff-9b2c3d4e5f6c', 'annual', NOW(), NOW())
ON CONFLICT ("billing_period_id") DO NOTHING;

