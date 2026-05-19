-- Permissão de Feriados
INSERT INTO "permission_action_groups" (
  "permission_action_group_id",
  "name",
  "description",
  "action"
) VALUES (
  '3f2fb4dd-d8e9-45b9-9b8f-468b98a5c5de',
  'Feriados',
  'Grupo de permissões relacionadas a feriados',
  'holiday_group'
)
ON CONFLICT ("permission_action_group_id") DO NOTHING;

INSERT INTO "permission_action" (
  "permission_action_id",
  "permission_module_id",
  "permission_action_group_id",
  "action",
  "name",
  "description"
) VALUES (
  '8d9b5750-7f24-4a39-84ff-d671f2490ad0',
  '019a930d-c6f6-766d-9c83-914b7faa4337',
  '3f2fb4dd-d8e9-45b9-9b8f-468b98a5c5de',
  'holiday_access',
  'Acesso a Feriados',
  'Permite acesso ao menu e às funcionalidades de feriados.'
)
ON CONFLICT ("permission_action_id") DO NOTHING;

-- Pré-marca para todos os cargos existentes
INSERT INTO "permission_role_action" (
  "permission_role_action_id",
  "permission_action_group_id",
  "permission_role_id"
)
SELECT
  gen_random_uuid(),
  '3f2fb4dd-d8e9-45b9-9b8f-468b98a5c5de',
  pr."permission_role_id"
FROM "permission_role" pr
WHERE NOT EXISTS (
  SELECT 1
  FROM "permission_role_action" existing
  WHERE existing."permission_role_id" = pr."permission_role_id"
    AND existing."permission_action_group_id" = '3f2fb4dd-d8e9-45b9-9b8f-468b98a5c5de'
);
