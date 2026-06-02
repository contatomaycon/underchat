-- Insert new plan product for Internal Chat
INSERT INTO "plan_product" ("plan_product_id", "name") VALUES
  ('867d1856-74f6-4e5d-a932-88c723af499d'::uuid, 'internal_chat')
ON CONFLICT ("plan_product_id") DO NOTHING;

-- Insert plan product description for Internal Chat
INSERT INTO "plan_product_description" ("plan_product_description_id", "plan_product_id", "name", "description", "created_at", "updated_at") VALUES
  ('2712b674-bd43-45ff-a392-78f502d89b6e'::uuid, '867d1856-74f6-4e5d-a932-88c723af499d'::uuid, 'Chat Interno', 'Acesso ao chat interno da conta.', NOW(), NOW())
ON CONFLICT ("plan_product_description_id") DO NOTHING;
