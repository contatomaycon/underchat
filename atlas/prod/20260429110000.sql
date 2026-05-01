-- Internal chat: conversations and participants (metadata in Postgres)
CREATE TABLE "internal_chat_conversation" (
  "internal_chat_conversation_id" uuid NOT NULL,
  "account_id" uuid NOT NULL,
  "type" character varying(20) NOT NULL,
  "direct_user_a_id" uuid NULL,
  "direct_user_b_id" uuid NULL,
  "direct_pair_key" character varying(120) NULL,
  "name" character varying(255) NULL,
  "photo" character varying(500) NULL,
  "leader_user_id" uuid NULL,
  "created_by_user_id" uuid NOT NULL,
  "last_message_id" character varying(80) NULL,
  "last_message_preview" text NULL,
  "last_message_at" timestamptz NULL,
  "created_at" timestamptz NULL DEFAULT now(),
  "updated_at" timestamptz NULL DEFAULT now(),
  "deleted_at" timestamptz NULL,
  PRIMARY KEY ("internal_chat_conversation_id"),
  CONSTRAINT "internal_chat_conversation_account_id_account_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "account" ("account_id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "internal_chat_conversation_direct_user_a_id_user_user_id_fk" FOREIGN KEY ("direct_user_a_id") REFERENCES "user" ("user_id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "internal_chat_conversation_direct_user_b_id_user_user_id_fk" FOREIGN KEY ("direct_user_b_id") REFERENCES "user" ("user_id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "internal_chat_conversation_leader_user_id_user_user_id_fk" FOREIGN KEY ("leader_user_id") REFERENCES "user" ("user_id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "internal_chat_conversation_created_by_user_id_user_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "user" ("user_id") ON UPDATE NO ACTION ON DELETE NO ACTION
);

CREATE TABLE "internal_chat_conversation_participant" (
  "internal_chat_conversation_participant_id" uuid NOT NULL,
  "internal_chat_conversation_id" uuid NOT NULL,
  "account_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "role" character varying(20) NOT NULL DEFAULT 'member',
  "is_active" boolean NOT NULL DEFAULT true,
  "closed_at" timestamptz NULL,
  "unread_count" integer NOT NULL DEFAULT 0,
  "last_read_message_id" character varying(80) NULL,
  "last_read_at" timestamptz NULL,
  "joined_at" timestamptz NULL DEFAULT now(),
  "created_at" timestamptz NULL DEFAULT now(),
  "updated_at" timestamptz NULL DEFAULT now(),
  "deleted_at" timestamptz NULL,
  PRIMARY KEY ("internal_chat_conversation_participant_id"),
  CONSTRAINT "internal_chat_conversation_participant_conversation_id_fk" FOREIGN KEY ("internal_chat_conversation_id") REFERENCES "internal_chat_conversation" ("internal_chat_conversation_id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "internal_chat_conversation_participant_account_id_account_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "account" ("account_id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "internal_chat_conversation_participant_user_id_user_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user" ("user_id") ON UPDATE NO ACTION ON DELETE NO ACTION
);

CREATE INDEX "internal_chat_conversation_account_id_idx" ON "internal_chat_conversation" ("account_id");
CREATE INDEX "internal_chat_conversation_type_idx" ON "internal_chat_conversation" ("type");
CREATE INDEX "internal_chat_conversation_last_message_at_idx" ON "internal_chat_conversation" ("last_message_at");
CREATE INDEX "internal_chat_conversation_deleted_at_idx" ON "internal_chat_conversation" ("deleted_at");
CREATE INDEX "internal_chat_conversation_direct_pair_key_idx" ON "internal_chat_conversation" ("direct_pair_key");
CREATE UNIQUE INDEX "internal_chat_conversation_direct_pair_key_unique" ON "internal_chat_conversation" ("account_id", "direct_pair_key") WHERE "type" = 'direct' AND "deleted_at" IS NULL;

CREATE INDEX "internal_chat_conversation_participant_conversation_id_idx" ON "internal_chat_conversation_participant" ("internal_chat_conversation_id");
CREATE INDEX "internal_chat_conversation_participant_user_id_idx" ON "internal_chat_conversation_participant" ("user_id");
CREATE INDEX "internal_chat_conversation_participant_account_id_idx" ON "internal_chat_conversation_participant" ("account_id");
CREATE INDEX "internal_chat_conversation_participant_closed_at_idx" ON "internal_chat_conversation_participant" ("closed_at");
CREATE INDEX "internal_chat_conversation_participant_deleted_at_idx" ON "internal_chat_conversation_participant" ("deleted_at");
CREATE UNIQUE INDEX "internal_chat_conversation_participant_unique" ON "internal_chat_conversation_participant" ("internal_chat_conversation_id", "user_id") WHERE "deleted_at" IS NULL;
CREATE INDEX "internal_chat_conversation_participant_open_by_user_idx" ON "internal_chat_conversation_participant" ("user_id", "closed_at", "deleted_at");

-- Dedicated permission group and actions for internal chat
INSERT INTO "permission_action_groups" (
  "permission_action_group_id",
  "name",
  "description",
  "action"
) VALUES (
  '8bb83d2b-5ac6-47c5-b4e4-0d5c4d5ac3f7',
  'Chat Interno',
  'Grupo de permissões relacionadas ao chat interno',
  'internal_chat_group'
)
ON CONFLICT ("permission_action_group_id") DO NOTHING;

INSERT INTO "permission_action" (
  "permission_action_id",
  "permission_module_id",
  "permission_action_group_id",
  "action",
  "name",
  "description"
) VALUES
  (
    '4cf2c648-413d-4fc2-bd80-28752f7d0d65',
    '019a930d-c6f6-766d-9c83-914b7faa4337',
    '8bb83d2b-5ac6-47c5-b4e4-0d5c4d5ac3f7',
    'internal_chat_group',
    'Grupo Chat Interno',
    'Permissão de agrupamento para funcionalidades do chat interno.'
  ),
  (
    '2601c5db-07e8-4389-a7bf-c86ddac8f132',
    '019a930d-c6f6-766d-9c83-914b7faa4337',
    '8bb83d2b-5ac6-47c5-b4e4-0d5c4d5ac3f7',
    'internal_chat_access',
    'Acessar Chat Interno',
    'Permite acessar e interagir com o chat interno da conta.'
  ),
  (
    '8fae7bf0-239a-41b8-9f29-b8b136ec875d',
    '019a930d-c6f6-766d-9c83-914b7faa4337',
    '8bb83d2b-5ac6-47c5-b4e4-0d5c4d5ac3f7',
    'internal_chat_group_create',
    'Criar Grupos Internos',
    'Permite criar grupos de chat interno.'
  ),
  (
    '5e41bc72-406c-4642-a6d2-0ab948fb00b8',
    '019a930d-c6f6-766d-9c83-914b7faa4337',
    '8bb83d2b-5ac6-47c5-b4e4-0d5c4d5ac3f7',
    'internal_chat_group_update',
    'Editar Grupos Internos',
    'Permite editar dados de grupos do chat interno.'
  ),
  (
    'f23b4ef7-cab4-4df4-9d47-e203748892f0',
    '019a930d-c6f6-766d-9c83-914b7faa4337',
    '8bb83d2b-5ac6-47c5-b4e4-0d5c4d5ac3f7',
    'internal_chat_group_manage_members',
    'Gerenciar membros de grupos internos',
    'Permite adicionar e remover membros dos grupos internos.'
  ),
  (
    '0d56aa06-090f-47e0-abf1-013435f0d4c4',
    '019a930d-c6f6-766d-9c83-914b7faa4337',
    '8bb83d2b-5ac6-47c5-b4e4-0d5c4d5ac3f7',
    'internal_chat_group_transfer_leader',
    'Transferir liderança de grupo interno',
    'Permite transferir a liderança de grupos internos.'
  )
ON CONFLICT ("permission_action_id") DO NOTHING;

INSERT INTO "permission_role_action" (
  "permission_role_action_id",
  "permission_action_id",
  "permission_role_id"
)
SELECT
  gen_random_uuid(),
  permission_action_id,
  pr."permission_role_id"
FROM "permission_role" pr
CROSS JOIN (
  VALUES
    ('4cf2c648-413d-4fc2-bd80-28752f7d0d65'::uuid),
    ('2601c5db-07e8-4389-a7bf-c86ddac8f132'::uuid),
    ('8fae7bf0-239a-41b8-9f29-b8b136ec875d'::uuid),
    ('5e41bc72-406c-4642-a6d2-0ab948fb00b8'::uuid),
    ('f23b4ef7-cab4-4df4-9d47-e203748892f0'::uuid),
    ('0d56aa06-090f-47e0-abf1-013435f0d4c4'::uuid)
) AS actions(permission_action_id)
WHERE NOT EXISTS (
  SELECT 1
  FROM "permission_role_action" existing
  WHERE existing."permission_role_id" = pr."permission_role_id"
    AND existing."permission_action_id" = actions.permission_action_id
);
