-- Insert seed "payment_billing_type" table
INSERT INTO "payment_billing_type" ("payment_billing_type_id", "name", "created_at", "updated_at") VALUES 
  ('019a930d-c6f4-75ad-88ff-9a1b2c3d4e5c', 'BOLETO', NOW(), NOW()),
  ('019a930d-c6f4-75ad-88ff-9b2c3d4e5f6c', 'CREDIT_CARD', NOW(), NOW()),
  ('019a930d-c6f4-75ad-88ff-9c3d4e5f6a7c', 'DEBIT_CARD', NOW(), NOW()),
  ('019a930d-c6f4-75ad-88ff-9d4e5f6a7b8c', 'TRANSFER', NOW(), NOW()),
  ('019a930d-c6f4-75ad-88ff-9e5f6a7b8c9c', 'DEPOSIT', NOW(), NOW()),
  ('019a930d-c6f4-75ad-88ff-9f6a7b8c9d0c', 'PIX', NOW(), NOW())
ON CONFLICT ("payment_billing_type_id") DO NOTHING;