-- Insert seed "credit_card_fee" table
INSERT INTO "credit_card_fee" (
  "credit_card_fee_id",
  "installment_1_rate",
  "installment_2_rate",
  "installment_3_rate",
  "installment_4_rate",
  "installment_5_rate",
  "installment_6_rate",
  "installment_7_rate",
  "installment_8_rate",
  "installment_9_rate",
  "installment_10_rate",
  "installment_11_rate",
  "installment_12_rate",
  "created_at",
  "updated_at"
) VALUES (
  '019b2a10-4e9c-7197-944b-71e6974a7433',
  2.99,
  4.69,
  6.39,
  8.09,
  9.79,
  11.49,
  13.19,
  14.89,
  16.59,
  18.29,
  19.99,
  21.69,
  NOW(),
  NOW()
) ON CONFLICT ("credit_card_fee_id") DO NOTHING;