-- Rename a constraint from "message_template_channel_pkey" to "message_template_channel_message_template_id_channel_id_pk"
ALTER TABLE "message_template_channel" RENAME CONSTRAINT "message_template_channel_pkey" TO "message_template_channel_message_template_id_channel_id_pk";
