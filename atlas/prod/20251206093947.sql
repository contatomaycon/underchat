-- Insert seed "account_payment_nfse_status" table
INSERT INTO "account_payment_nfse_status" ("account_payment_nfse_status_id", "name", "created_at", "updated_at") VALUES 
  ('019a930d-c6f4-75ad-88ff-9a1b2c3d4e5e', 'SCHEDULED', NOW(), NOW()),
  ('019a930d-c6f4-75ad-88ff-9b2c3d4e5f6e', 'AUTHORIZED', NOW(), NOW()),
  ('019a930d-c6f4-75ad-88ff-9c3d4e5f6a7e', 'PROCESSING_CANCELLATION', NOW(), NOW()),
  ('019a930d-c6f4-75ad-88ff-9d4e5f6a7b8e', 'CANCELED', NOW(), NOW()),
  ('019a930d-c6f4-75ad-88ff-9e5f6a7b8c9e', 'CANCELLATION_DENIED', NOW(), NOW()),
  ('019a930d-c6f4-75ad-88ff-9f6a7b8c9d0e', 'ERROR', NOW(), NOW()),
  ('019a930d-c6f4-75ad-88ff-9a1b2c3d4e7e', 'SYNCHRONIZED', NOW(), NOW())
ON CONFLICT ("account_payment_nfse_status_id") DO NOTHING;