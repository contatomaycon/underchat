-- Permissão: visualizar conteúdo do dashboard na página inicial
INSERT INTO "permission_action" (
  "permission_action_id",
  "permission_module_id",
  "permission_action_group_id",
  "action",
  "name",
  "description"
) VALUES (
  '5797f39b-e88c-455c-b80d-b5fced89e9f1',
  '019a930d-c6f6-766d-9c83-914b7faa4337',
  '019a930d-c6f6-766d-9c83-c9616d371514',
  'dashboard_view',
  'Visualização de Dashboard',
  'Permite visualizar cards, gráficos e estatísticas da página inicial.'
)
ON CONFLICT ("permission_action_id") DO NOTHING;

-- Pré-marca para todos os grupos de acesso existentes
INSERT INTO "permission_role_action" (
  "permission_role_action_id",
  "permission_action_id",
  "permission_role_id"
)
SELECT
  gen_random_uuid(),
  '5797f39b-e88c-455c-b80d-b5fced89e9f1',
  pr."permission_role_id"
FROM "permission_role" pr
WHERE NOT EXISTS (
  SELECT 1
  FROM "permission_role_action" existing
  WHERE existing."permission_role_id" = pr."permission_role_id"
    AND existing."permission_action_id" = '5797f39b-e88c-455c-b80d-b5fced89e9f1'
);
