-- Add "channel_id" column to table: "message_template"
ALTER TABLE "message_template" ADD COLUMN "channel_id" uuid NULL;
-- Create foreign key for "message_template" -> "worker"
ALTER TABLE "message_template" ADD CONSTRAINT "message_template_channel_id_worker_worker_id_fk" FOREIGN KEY ("channel_id") REFERENCES "worker" ("worker_id") ON UPDATE NO ACTION ON DELETE NO ACTION;
-- Create index "message_template_channel_id_idx" to table: "message_template"
CREATE INDEX "message_template_channel_id_idx" ON "message_template" ("channel_id");
-- Create index "message_template_account_id_channel_id_deleted_at_idx" to table: "message_template"
CREATE INDEX "message_template_account_id_channel_id_deleted_at_idx" ON "message_template" ("account_id", "channel_id", "deleted_at");
