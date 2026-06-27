CREATE TABLE IF NOT EXISTS "chat_user_pinned_chat" (
  "chat_user_pinned_chat_id" uuid PRIMARY KEY,
  "user_id" uuid NOT NULL REFERENCES "user" ("user_id") ON DELETE CASCADE,
  "chat_id" uuid NOT NULL,
  "pinned_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "chat_user_pinned_chat_user_chat_uidx"
ON "chat_user_pinned_chat" ("user_id", "chat_id");

CREATE INDEX IF NOT EXISTS "chat_user_pinned_chat_user_pinned_at_idx"
ON "chat_user_pinned_chat" ("user_id", "pinned_at");

CREATE INDEX IF NOT EXISTS "chat_user_pinned_chat_chat_id_idx"
ON "chat_user_pinned_chat" ("chat_id");

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'chat_user'
      AND column_name = 'pinned_chat_id'
  ) THEN
    INSERT INTO "chat_user_pinned_chat" (
      "chat_user_pinned_chat_id",
      "user_id",
      "chat_id",
      "pinned_at"
    )
    SELECT
      gen_random_uuid(),
      "user_id",
      "pinned_chat_id",
      now()
    FROM "chat_user"
    WHERE "pinned_chat_id" IS NOT NULL
    ON CONFLICT ("user_id", "chat_id") DO NOTHING;

    DROP INDEX IF EXISTS "chat_user_pinned_chat_id_idx";
    ALTER TABLE "chat_user" DROP COLUMN IF EXISTS "pinned_chat_id";
  END IF;
END $$;
