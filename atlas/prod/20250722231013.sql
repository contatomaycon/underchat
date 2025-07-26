INSERT INTO "plan_product" ("plan_product_id", "name") VALUES (1, 'worker');
INSERT INTO "plan_product" ("plan_product_id", "name") VALUES (2, 'role');
INSERT INTO "plan_product" ("plan_product_id", "name") VALUES (3, 'user');
INSERT INTO "plan" ("plan_id", "name", "price", "price_old") VALUES (1, 'Diamante', 200.00, 300.00);
INSERT INTO "plan_items" ("plan_item_id", "plan_product_id", "plan_id", "quantity") VALUES (1, 1, 1, 5);
INSERT INTO "account" ("account_id", "account_status_id", "plan_id", "name") VALUES (1, 1, 1, 'Underchat');