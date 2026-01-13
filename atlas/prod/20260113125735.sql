-- Create index "plan_cross_sell_plan_product_id_plan_cross_sell_id_idx" to table: "plan_cross_sell"
CREATE INDEX "plan_cross_sell_plan_product_id_plan_cross_sell_id_idx" ON "plan_cross_sell" ("plan_product_id", "plan_cross_sell_id");
-- Create index "plan_cross_sell_account_account_id_plan_cross_sell_id_deleted_a" to table: "plan_cross_sell_account"
CREATE INDEX "plan_cross_sell_account_account_id_plan_cross_sell_id_deleted_a" ON "plan_cross_sell_account" ("account_id", "plan_cross_sell_id", "deleted_at");
