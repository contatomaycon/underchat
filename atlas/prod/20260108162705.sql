-- Insert new plan product for AI Agent
INSERT INTO "plan_product" ("plan_product_id", "name") VALUES
  ('019b9f13-63a8-74ca-b294-cd0c810c6c82'::uuid, 'ai_agent')
ON CONFLICT ("plan_product_id") DO NOTHING;

-- Insert plan product description for AI Agent
INSERT INTO "plan_product_description" ("plan_product_description_id", "plan_product_id", "name", "description", "created_at", "updated_at") VALUES
  ('019b9f13-63aa-73d0-b474-8a498fe5c68e'::uuid, '019b9f13-63a8-74ca-b294-cd0c810c6c82'::uuid, 'Agente de IA', 'Quantidade de agentes de IA disponíveis.', NOW(), NOW())
ON CONFLICT ("plan_product_description_id") DO NOTHING;