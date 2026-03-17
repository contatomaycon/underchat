-- Add column "cancellation_date" to table: "plan_cross_sell_account"
ALTER TABLE "plan_cross_sell_account" ADD COLUMN "cancellation_date" timestamptz NULL;

-- Add column "is_addon_only" to table: "account_payment"
ALTER TABLE "account_payment" ADD COLUMN "is_addon_only" boolean NOT NULL DEFAULT false;

-- Create index "plan_cross_sell_account_cancellation_date_idx" to table: "plan_cross_sell_account"
CREATE INDEX "plan_cross_sell_account_cancellation_date_idx" ON "plan_cross_sell_account" ("cancellation_date");

-- Create index "plan_cross_sell_account_acc_del_can_date_idx" to table: "plan_cross_sell_account"
CREATE INDEX "plan_cross_sell_account_acc_del_can_date_idx" ON "plan_cross_sell_account" ("account_id", "deleted_at", "cancellation_date");

-- Create index "account_payment_is_addon_only_idx" to table: "account_payment"
CREATE INDEX "account_payment_is_addon_only_idx" ON "account_payment" ("is_addon_only");
