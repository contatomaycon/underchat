-- Insert seed "plan_account" table
INSERT INTO "plan_account" (
  "plan_account_id",
  "account_id",
  "plan_id",
  "recurring_payment",
  "billing_period_id",
  "last_payment_date",
  "next_payment_date",
  "cancellation_date",
  "value",
  "created_at",
  "updated_at"
) VALUES (
  'a8c35223-ba8a-45ae-a67c-c9d924a9a2b3',
  '019a930d-c6f4-75ad-88ff-8d2fcd5839e1',
  '019a930d-c6f4-75ad-88ff-847edc5f724c',
  true,
  '019a930d-c6f4-75ad-88ff-9b2c3d4e5f6c',
  '2025-01-01 15:43:26.672000 +00:00',
  '2100-01-01 15:43:34.917000 +00:00',
  NULL,
  '2500.00',
  '2025-12-04 18:43:48.412140 +00:00',
  '2025-12-04 18:43:48.412140 +00:00'
)
ON CONFLICT ("plan_account_id") DO NOTHING;

