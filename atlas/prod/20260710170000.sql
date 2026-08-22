ALTER TABLE "outbound_webhook_event"
  DROP CONSTRAINT IF EXISTS "outbound_webhook_event_state_check";

ALTER TABLE "outbound_webhook_event"
  ADD CONSTRAINT "outbound_webhook_event_state_check"
  CHECK (
    "state" IN (
      'preparing',
      'ready',
      'discarded',
      'cancelled',
      'quarantined'
    )
  );
