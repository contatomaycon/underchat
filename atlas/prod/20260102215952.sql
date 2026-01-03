-- Add auto_send column to message_template table
ALTER TABLE "message_template" ADD COLUMN "auto_send" boolean NOT NULL DEFAULT false;