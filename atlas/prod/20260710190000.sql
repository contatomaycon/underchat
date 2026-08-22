ALTER TABLE "outbound_webhook_event"
  ADD COLUMN IF NOT EXISTS "domain_applied_at" timestamp with time zone;

COMMENT ON COLUMN "outbound_webhook_event"."domain_applied_at" IS
  'Set atomically with the domain mutation after the final public event payload is persisted; NULL for unapplied intents and legacy producers.';
