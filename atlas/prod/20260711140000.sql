-- Freeze the Integration entitlement epoch on each outbound event. Existing
-- rows intentionally remain NULL and are suppressed by dispatcher preflight.
ALTER TABLE "outbound_webhook_event"
  ADD COLUMN IF NOT EXISTS "integration_entitlement_revision" varchar(64);

COMMENT ON COLUMN "outbound_webhook_event"."integration_entitlement_revision" IS
  'Integration entitlement revision captured when the event was created; NULL identifies legacy events that must not be replayed.';
