-- Track the payment that materialized each add-on assignment. Administrative
-- and legacy assignments remain NULL and are therefore never removed by a
-- later refund for an unrelated payment.
ALTER TABLE "plan_cross_sell_account"
  ADD COLUMN "account_payment_id" uuid NULL,
  ADD CONSTRAINT "plan_cross_sell_account_account_payment_id_account_payment_account_payment_id_fk"
    FOREIGN KEY ("account_payment_id")
    REFERENCES "account_payment" ("account_payment_id")
    ON UPDATE NO ACTION
    ON DELETE NO ACTION;

CREATE INDEX "plan_cross_sell_account_account_payment_id_idx"
  ON "plan_cross_sell_account" ("account_payment_id");
