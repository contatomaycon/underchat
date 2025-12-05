-- Insert seed "payment_status" table
INSERT INTO "payment_status" ("payment_status_id", "name", "created_at", "updated_at") VALUES 
  ('019a930d-c6f4-75ad-88ff-9a1b2c3d4e5d', 'PENDING', NOW(), NOW()),
  ('019a930d-c6f4-75ad-88ff-9b2c3d4e5f6d', 'RECEIVED', NOW(), NOW()),
  ('019a930d-c6f4-75ad-88ff-9c3d4e5f6a7d', 'CONFIRMED', NOW(), NOW()),
  ('019a930d-c6f4-75ad-88ff-9d4e5f6a7b8d', 'OVERDUE', NOW(), NOW()),
  ('019a930d-c6f4-75ad-88ff-9e5f6a7b8c9d', 'REFUNDED', NOW(), NOW()),
  ('019a930d-c6f4-75ad-88ff-9f6a7b8c9d0d', 'RECEIVED_IN_CASH', NOW(), NOW()),
  ('019a930d-c6f4-75ad-88ff-9a7b8c9d0e1d', 'REFUND_REQUESTED', NOW(), NOW()),
  ('019a930d-c6f4-75ad-88ff-9b8c9d0e1f2d', 'REFUND_IN_PROGRESS', NOW(), NOW()),
  ('019a930d-c6f4-75ad-88ff-9c9d0e1f2a3d', 'CHARGEBACK_REQUESTED', NOW(), NOW()),
  ('019a930d-c6f4-75ad-88ff-9d0e1f2a3b4d', 'CHARGEBACK_DISPUTE', NOW(), NOW()),
  ('019a930d-c6f4-75ad-88ff-9e1f2a3b4c5d', 'AWAITING_CHARGEBACK_REVERSAL', NOW(), NOW()),
  ('019a930d-c6f4-75ad-88ff-9f2a3b4c5d6d', 'DUNNING_REQUESTED', NOW(), NOW()),
  ('019a930d-c6f4-75ad-88ff-9a3b4c5d6e7d', 'DUNNING_RECEIVED', NOW(), NOW()),
  ('019a930d-c6f4-75ad-88ff-9b4c5d6e7f8d', 'AWAITING_RISK_ANALYSIS', NOW(), NOW())
ON CONFLICT ("payment_status_id") DO NOTHING;