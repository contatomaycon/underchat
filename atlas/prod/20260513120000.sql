-- Add per-channel notification status toggles.
ALTER TABLE "notifications"
  ADD COLUMN "whatsapp_enabled" boolean NOT NULL DEFAULT false,
  ADD COLUMN "email_enabled" boolean NOT NULL DEFAULT false;
