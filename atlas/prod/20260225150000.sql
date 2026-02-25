-- Create "random_message" table
CREATE TABLE "random_message" (
  "random_message_id" uuid NOT NULL,
  "account_id" uuid NOT NULL,
  "name" character varying(250) NOT NULL,
  "status" character varying(20) NOT NULL DEFAULT 'active',
  "created_at" timestamptz NULL DEFAULT now(),
  "updated_at" timestamptz NULL DEFAULT now(),
  PRIMARY KEY ("random_message_id"),
  CONSTRAINT "random_message_account_id_account_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "account" ("account_id") ON UPDATE NO ACTION ON DELETE NO ACTION
);
-- Create index "random_message_account_id_idx" to table: "random_message"
CREATE INDEX "random_message_account_id_idx" ON "random_message" ("account_id");
-- Create index "random_message_status_idx" to table: "random_message"
CREATE INDEX "random_message_status_idx" ON "random_message" ("status");
-- Create index "random_message_name_idx" to table: "random_message"
CREATE INDEX "random_message_name_idx" ON "random_message" ("name");
-- Create index "random_message_created_at_idx" to table: "random_message"
CREATE INDEX "random_message_created_at_idx" ON "random_message" ("created_at");

-- Create "random_message_item" table
CREATE TABLE "random_message_item" (
  "random_message_item_id" uuid NOT NULL,
  "random_message_id" uuid NOT NULL,
  "account_id" uuid NOT NULL,
  "message" text NOT NULL,
  "status" character varying(20) NOT NULL DEFAULT 'active',
  "type" character varying(50) NOT NULL DEFAULT 'text',
  "attachment_url" character varying(500) NULL,
  "mimetype" character varying(100) NULL,
  "duration" integer NULL,
  "width" integer NULL,
  "height" integer NULL,
  "created_at" timestamptz NULL DEFAULT now(),
  "updated_at" timestamptz NULL DEFAULT now(),
  PRIMARY KEY ("random_message_item_id"),
  CONSTRAINT "random_message_item_random_message_id_random_message_random_message_id_fk" FOREIGN KEY ("random_message_id") REFERENCES "random_message" ("random_message_id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "random_message_item_account_id_account_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "account" ("account_id") ON UPDATE NO ACTION ON DELETE NO ACTION
);
-- Create index "random_message_item_random_message_id_idx" to table: "random_message_item"
CREATE INDEX "random_message_item_random_message_id_idx" ON "random_message_item" ("random_message_id");
-- Create index "random_message_item_account_id_idx" to table: "random_message_item"
CREATE INDEX "random_message_item_account_id_idx" ON "random_message_item" ("account_id");
-- Create index "random_message_item_status_idx" to table: "random_message_item"
CREATE INDEX "random_message_item_status_idx" ON "random_message_item" ("status");
-- Create index "random_message_item_created_at_idx" to table: "random_message_item"
CREATE INDEX "random_message_item_created_at_idx" ON "random_message_item" ("created_at");

-- Insert permission action group
INSERT INTO "permission_action_groups" ("permission_action_group_id", "name", "description", "action") VALUES
  ('0643abd8-e649-4218-961b-14b2489886fc', 'Mensagens Aleatórias', 'Grupo de permissões relacionadas a mensagens aleatórias', 'random_message_group')
ON CONFLICT ("permission_action_group_id") DO NOTHING;

-- Insert permission actions
INSERT INTO "permission_action" ("permission_action_id", "permission_module_id", "permission_action_group_id", "action", "name", "description") VALUES
  ('93fd564e-5a80-410b-a4b7-9d277920e25d', '019a930d-c6f6-766d-9c83-914b7faa4337', '0643abd8-e649-4218-961b-14b2489886fc', 'random_message_view', 'Visualizar Mensagens Aleatórias', 'Permite visualizar, listar e buscar mensagens aleatórias')
ON CONFLICT ("permission_action_id") DO NOTHING;
INSERT INTO "permission_action" ("permission_action_id", "permission_module_id", "permission_action_group_id", "action", "name", "description") VALUES
  ('dcea1659-5adc-4669-aa76-645424730b0a', '019a930d-c6f6-766d-9c83-914b7faa4337', '0643abd8-e649-4218-961b-14b2489886fc', 'random_message_create', 'Criar Mensagens Aleatórias', 'Permite criar mensagens aleatórias e seus itens')
ON CONFLICT ("permission_action_id") DO NOTHING;
INSERT INTO "permission_action" ("permission_action_id", "permission_module_id", "permission_action_group_id", "action", "name", "description") VALUES
  ('23b984a1-ccb3-4965-8df3-67bf2f283cf7', '019a930d-c6f6-766d-9c83-914b7faa4337', '0643abd8-e649-4218-961b-14b2489886fc', 'random_message_update', 'Atualizar Mensagens Aleatórias', 'Permite atualizar mensagens aleatórias e seus itens')
ON CONFLICT ("permission_action_id") DO NOTHING;
INSERT INTO "permission_action" ("permission_action_id", "permission_module_id", "permission_action_group_id", "action", "name", "description") VALUES
  ('a4935517-fe7d-4a0f-8b81-0315fbfe36bc', '019a930d-c6f6-766d-9c83-914b7faa4337', '0643abd8-e649-4218-961b-14b2489886fc', 'random_message_delete', 'Excluir Mensagens Aleatórias', 'Permite excluir mensagens aleatórias e seus itens')
ON CONFLICT ("permission_action_id") DO NOTHING;
