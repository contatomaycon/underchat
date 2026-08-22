ALTER TABLE "outbound_webhook_event"
  ADD COLUMN IF NOT EXISTS "target_snapshot" jsonb;

ALTER TABLE "outbound_webhook_event"
  DROP CONSTRAINT IF EXISTS "outbound_webhook_event_target_snapshot_check";

ALTER TABLE "outbound_webhook_event"
  ADD CONSTRAINT "outbound_webhook_event_target_snapshot_check"
  CHECK (
    "target_snapshot" IS NULL
    OR (
      jsonb_typeof("target_snapshot") = 'array'
      AND jsonb_array_length("target_snapshot") <= 25
    )
  );

COMMENT ON COLUMN "outbound_webhook_event"."target_snapshot" IS
  'Immutable webhook/config recipients captured before the domain mutation; NULL only for legacy rows.';
