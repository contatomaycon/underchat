ALTER TABLE "chatbot"
  ADD COLUMN IF NOT EXISTS "status" character varying(20) NOT NULL DEFAULT 'active';

ALTER TABLE "permission_role"
  ADD COLUMN IF NOT EXISTS "status" character varying(20) NOT NULL DEFAULT 'active';

CREATE INDEX IF NOT EXISTS "chatbot_status_idx" ON "chatbot" ("status");
CREATE INDEX IF NOT EXISTS "chatbot_account_id_status_idx" ON "chatbot" ("account_id", "status");
CREATE INDEX IF NOT EXISTS "permission_role_status_idx" ON "permission_role" ("status");
CREATE INDEX IF NOT EXISTS "permission_role_account_id_status_deleted_at_idx"
  ON "permission_role" ("account_id", "status", "deleted_at");

CREATE TABLE IF NOT EXISTS "plan_limit_enforcement_checkpoint" (
  "account_id" uuid PRIMARY KEY NOT NULL REFERENCES "account" ("account_id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  "last_checked_at" timestamptz NULL,
  "last_started_at" timestamptz NULL,
  "last_finished_at" timestamptz NULL,
  "last_error" text NULL,
  "created_at" timestamptz NULL DEFAULT now(),
  "updated_at" timestamptz NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "plan_limit_checkpoint_last_checked_at_idx"
  ON "plan_limit_enforcement_checkpoint" ("last_checked_at");
CREATE INDEX IF NOT EXISTS "plan_limit_checkpoint_last_started_at_idx"
  ON "plan_limit_enforcement_checkpoint" ("last_started_at");
