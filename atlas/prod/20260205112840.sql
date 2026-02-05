-- Create "user_channel" table
CREATE TABLE "user_channel" (
  "user_channel_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "channel_id" uuid NOT NULL,
  "account_id" uuid NOT NULL,
  "created_at" timestamptz NULL DEFAULT now(),
  "updated_at" timestamptz NULL DEFAULT now(),
  PRIMARY KEY ("user_channel_id"),
  CONSTRAINT "user_channel_account_id_account_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "account" ("account_id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "user_channel_channel_id_worker_worker_id_fk" FOREIGN KEY ("channel_id") REFERENCES "worker" ("worker_id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "user_channel_user_id_user_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user" ("user_id") ON UPDATE NO ACTION ON DELETE NO ACTION
);
-- Create index "user_channel_account_id_channel_id_idx" to table: "user_channel"
CREATE INDEX "user_channel_account_id_channel_id_idx" ON "user_channel" ("account_id", "channel_id");
-- Create index "user_channel_account_id_idx" to table: "user_channel"
CREATE INDEX "user_channel_account_id_idx" ON "user_channel" ("account_id");
-- Create index "user_channel_channel_id_idx" to table: "user_channel"
CREATE INDEX "user_channel_channel_id_idx" ON "user_channel" ("channel_id");
-- Create index "user_channel_user_id_account_id_idx" to table: "user_channel"
CREATE INDEX "user_channel_user_id_account_id_idx" ON "user_channel" ("user_id", "account_id");
-- Create index "user_channel_user_id_channel_id_idx" to table: "user_channel"
CREATE INDEX "user_channel_user_id_channel_id_idx" ON "user_channel" ("user_id", "channel_id");
-- Create index "user_channel_user_id_idx" to table: "user_channel"
CREATE INDEX "user_channel_user_id_idx" ON "user_channel" ("user_id");
