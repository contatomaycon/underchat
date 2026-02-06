-- Create "contact_channel" table
CREATE TABLE "contact_channel" (
  "contact_channel_id" uuid NOT NULL,
  "contact_id" uuid NOT NULL,
  "channel_id" uuid NOT NULL,
  "account_id" uuid NOT NULL,
  "created_at" timestamptz NULL DEFAULT now(),
  "updated_at" timestamptz NULL DEFAULT now(),
  PRIMARY KEY ("contact_channel_id"),
  CONSTRAINT "contact_channel_account_id_account_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "account" ("account_id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "contact_channel_channel_id_worker_worker_id_fk" FOREIGN KEY ("channel_id") REFERENCES "worker" ("worker_id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "contact_channel_contact_id_contact_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "contact" ("contact_id") ON UPDATE NO ACTION ON DELETE NO ACTION
);
-- Create index "contact_channel_account_id_channel_id_idx" to table: "contact_channel"
CREATE INDEX "contact_channel_account_id_channel_id_idx" ON "contact_channel" ("account_id", "channel_id");
-- Create index "contact_channel_account_id_idx" to table: "contact_channel"
CREATE INDEX "contact_channel_account_id_idx" ON "contact_channel" ("account_id");
-- Create index "contact_channel_channel_id_idx" to table: "contact_channel"
CREATE INDEX "contact_channel_channel_id_idx" ON "contact_channel" ("channel_id");
-- Create index "contact_channel_contact_id_account_id_idx" to table: "contact_channel"
CREATE INDEX "contact_channel_contact_id_account_id_idx" ON "contact_channel" ("contact_id", "account_id");
-- Create index "contact_channel_contact_id_channel_id_idx" to table: "contact_channel"
CREATE INDEX "contact_channel_contact_id_channel_id_idx" ON "contact_channel" ("contact_id", "channel_id");
-- Create index "contact_channel_contact_id_idx" to table: "contact_channel"
CREATE INDEX "contact_channel_contact_id_idx" ON "contact_channel" ("contact_id");
