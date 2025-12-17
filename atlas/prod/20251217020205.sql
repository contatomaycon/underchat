-- Create "credit_card_fee" table
CREATE TABLE "credit_card_fee" (
  "credit_card_fee_id" uuid NOT NULL,
  "installment_1_rate" numeric(5,2) NOT NULL,
  "installment_2_rate" numeric(5,2) NOT NULL,
  "installment_3_rate" numeric(5,2) NOT NULL,
  "installment_4_rate" numeric(5,2) NOT NULL,
  "installment_5_rate" numeric(5,2) NOT NULL,
  "installment_6_rate" numeric(5,2) NOT NULL,
  "installment_7_rate" numeric(5,2) NOT NULL,
  "installment_8_rate" numeric(5,2) NOT NULL,
  "installment_9_rate" numeric(5,2) NOT NULL,
  "installment_10_rate" numeric(5,2) NOT NULL,
  "installment_11_rate" numeric(5,2) NOT NULL,
  "installment_12_rate" numeric(5,2) NOT NULL,
  "created_at" timestamptz NULL DEFAULT now(),
  "updated_at" timestamptz NULL DEFAULT now(),
  "deleted_at" timestamptz NULL,
  PRIMARY KEY ("credit_card_fee_id")
);