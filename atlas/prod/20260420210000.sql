-- Ajusta texto da permissão (comportamento: com permissão = pode optar; sem = motivo obrigatório)
UPDATE "permission_action"
SET
  "name" = 'Motivo do encerramento',
  "description" = 'Permite ativar ou desativar o preenchimento do motivo ao encerrar o atendimento na própria tela.'
WHERE "action" = 'require_chat_closure_comment';

-- Pré-marca nos mesmos cargos que já têm "Desabilitar mensagem ao finalizar atendimento"
INSERT INTO "permission_role_action" ("permission_role_action_id", "permission_action_id", "permission_role_id")
SELECT gen_random_uuid(), 'b2e8f4ac-1d39-4f6c-a7b1-9e8d7c6b5a40', pra."permission_role_id"
FROM "permission_role_action" pra
WHERE pra."permission_action_id" = '9cb0bcef-7139-4c4a-abdd-25f43c68907c'
  AND NOT EXISTS (
    SELECT 1
    FROM "permission_role_action" existing
    WHERE existing."permission_role_id" = pra."permission_role_id"
      AND existing."permission_action_id" = 'b2e8f4ac-1d39-4f6c-a7b1-9e8d7c6b5a40'
  );
