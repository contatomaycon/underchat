-- Insert seed "method_payment" table
INSERT INTO "method_payment" ("method_payment_id", "type", "status", "created_at", "updated_at") VALUES 
  ('019a930d-c6f4-75ad-88ff-9a1b2c3d4e7a', 'boleto', true, NOW(), NOW()),
  ('019a930d-c6f4-75ad-88ff-9b2c3d4e5f7c', 'credit_card', true, NOW(), NOW()),
  ('019a930d-c6f4-75ad-88ff-9c3d4e5f6a7d', 'pix', true, NOW(), NOW())
ON CONFLICT ("method_payment_id") DO NOTHING;