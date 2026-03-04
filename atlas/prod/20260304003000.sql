-- Create "message_template_channel" table
CREATE TABLE "message_template_channel" (
  "message_template_id" uuid NOT NULL,
  "channel_id" uuid NOT NULL,
  "created_at" timestamptz NULL DEFAULT now(),
  PRIMARY KEY ("message_template_id", "channel_id"),
  CONSTRAINT "message_template_channel_message_template_id_message_template_m" FOREIGN KEY ("message_template_id") REFERENCES "message_template" ("message_template_id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "message_template_channel_channel_id_worker_worker_id_fk" FOREIGN KEY ("channel_id") REFERENCES "worker" ("worker_id") ON UPDATE NO ACTION ON DELETE NO ACTION
);
-- Create index "message_template_channel_message_template_id_idx" to table: "message_template_channel"
CREATE INDEX "message_template_channel_message_template_id_idx" ON "message_template_channel" ("message_template_id");
-- Create index "message_template_channel_channel_id_idx" to table: "message_template_channel"
CREATE INDEX "message_template_channel_channel_id_idx" ON "message_template_channel" ("channel_id");
-- Create index "message_template_channel_message_template_id_channel_id_idx" to table: "message_template_channel"
CREATE INDEX "message_template_channel_message_template_id_channel_id_idx" ON "message_template_channel" ("message_template_id", "channel_id");
-- Backfill legacy single-channel templates to association table
INSERT INTO "message_template_channel" ("message_template_id", "channel_id")
SELECT "message_template_id", "channel_id"
FROM "message_template"
WHERE "channel_id" IS NOT NULL
ON CONFLICT DO NOTHING;
