-- Create "chat_closure_comment" table
CREATE TABLE "chat_closure_comment" (
  "chat_closure_comment_id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "account_id" uuid NOT NULL,
  "chat_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "comment" text NOT NULL,
  "closed_at" timestamptz NOT NULL,
  "created_at" timestamptz NULL DEFAULT now(),
  "updated_at" timestamptz NULL DEFAULT now(),
  CONSTRAINT "chat_closure_comment_pkey" PRIMARY KEY ("chat_closure_comment_id"),
  CONSTRAINT "chat_closure_comment_account_id_account_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "account" ("account_id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "chat_closure_comment_user_id_user_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user" ("user_id") ON UPDATE NO ACTION ON DELETE NO ACTION
);

-- Create index "chat_closure_comment_account_id_idx" to table: "chat_closure_comment"
CREATE INDEX "chat_closure_comment_account_id_idx" ON "chat_closure_comment" ("account_id");

-- Create index "chat_closure_comment_chat_id_idx" to table: "chat_closure_comment"
CREATE INDEX "chat_closure_comment_chat_id_idx" ON "chat_closure_comment" ("chat_id");

-- Create index "chat_closure_comment_user_id_idx" to table: "chat_closure_comment"
CREATE INDEX "chat_closure_comment_user_id_idx" ON "chat_closure_comment" ("user_id");

-- Create index "chat_closure_comment_account_id_chat_id_idx" to table: "chat_closure_comment"
CREATE INDEX "chat_closure_comment_account_id_chat_id_idx" ON "chat_closure_comment" ("account_id", "chat_id");
