-- Permissão: visualizar número de telefone completo do contato (desmascarar)
INSERT INTO "permission_action" ("permission_action_id", "permission_module_id", "permission_action_group_id", "action", "name", "description") VALUES ('c9a4e8f1-2b3d-4c5e-8f6a-7b8c9d0e1f2a', '019a930d-c6f6-766d-9c83-914b7faa4337', '019a930d-c6f6-766d-9c83-a01975e5c60d', 'contact_view_phone', 'Visualizar número de telefone', 'Permite visualizar o número completo de telefone de contatos (desmascarar)');

-- Habilitar para os mesmos cargos que já tinham "Visualizar Contato" (permissão granular)
INSERT INTO "permission_role_action" ("permission_role_action_id", "permission_action_id", "permission_role_id")
SELECT gen_random_uuid(), 'c9a4e8f1-2b3d-4c5e-8f6a-7b8c9d0e1f2a', pra."permission_role_id"
FROM "permission_role_action" pra
WHERE pra."permission_action_id" = '019a930d-c6f8-7526-872d-0d2bf189d868'
  AND NOT EXISTS (
    SELECT 1
    FROM "permission_role_action" existing
    WHERE existing."permission_role_id" = pra."permission_role_id"
      AND existing."permission_action_id" = 'c9a4e8f1-2b3d-4c5e-8f6a-7b8c9d0e1f2a'
  );
