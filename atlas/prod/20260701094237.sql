ALTER TABLE "whatsapp_embedded_config"
  ADD COLUMN IF NOT EXISTS "webhook_verify_token_encrypted" varchar(4000);
