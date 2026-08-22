CREATE TABLE IF NOT EXISTS "public_api_token" (
  "public_api_token_id" uuid PRIMARY KEY NOT NULL,
  "account_id" uuid NOT NULL,
  "actor_user_id" uuid NOT NULL,
  "token_hash" varchar(64) NOT NULL,
  "token_encrypted" varchar(512) NOT NULL,
  "token_preview" varchar(32) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "rotated_at" timestamp with time zone,
  "last_used_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  CONSTRAINT "public_api_token_account_id_account_account_id_fk"
    FOREIGN KEY ("account_id") REFERENCES "account" ("account_id")
    ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "public_api_token_actor_user_id_user_user_id_fk"
    FOREIGN KEY ("actor_user_id") REFERENCES "user" ("user_id")
    ON UPDATE NO ACTION ON DELETE NO ACTION
);

CREATE UNIQUE INDEX IF NOT EXISTS "public_api_token_token_hash_uidx"
  ON "public_api_token" ("token_hash");

CREATE UNIQUE INDEX IF NOT EXISTS "public_api_token_active_account_uidx"
  ON "public_api_token" ("account_id")
  WHERE "revoked_at" IS NULL;

CREATE INDEX IF NOT EXISTS "public_api_token_actor_user_id_idx"
  ON "public_api_token" ("actor_user_id");

CREATE INDEX IF NOT EXISTS "public_api_token_account_id_created_at_idx"
  ON "public_api_token" ("account_id", "created_at" DESC NULLS LAST);
