-- Permissão: visualizar todos os canais somente como destino de transferência
-- ou encaminhamento, sem ampliar o escopo de acesso aos atendimentos.
INSERT INTO "permission_action" (
  "permission_action_id",
  "permission_module_id",
  "permission_action_group_id",
  "action",
  "name",
  "description"
) VALUES (
  '6f093737-1c5a-4c4d-b5a7-1af0480e3d85',
  '019a930d-c6f6-766d-9c83-914b7faa4337',
  '019a930d-c6f6-766d-9c83-c68d845f1195',
  'view_all_channels_for_transfer_and_forwarding',
  'Visualizar todos os canais para transferência e encaminhamento',
  'Permite visualizar e selecionar qualquer canal da conta somente como destino de transferência ou encaminhamento.'
)
ON CONFLICT ("permission_action_id") DO NOTHING;

-- Habilitar por padrão para todos os grupos de acesso existentes.
INSERT INTO "permission_role_action" (
  "permission_role_action_id",
  "permission_action_id",
  "permission_role_id"
)
SELECT
  gen_random_uuid(),
  '6f093737-1c5a-4c4d-b5a7-1af0480e3d85',
  pr."permission_role_id"
FROM "permission_role" pr
WHERE NOT EXISTS (
  SELECT 1
  FROM "permission_role_action" existing
  WHERE existing."permission_role_id" = pr."permission_role_id"
    AND existing."permission_action_id" = '6f093737-1c5a-4c4d-b5a7-1af0480e3d85'
);
