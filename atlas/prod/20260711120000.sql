-- Outbound webhooks are not released yet. Reset only this feature's data so
-- channel ownership and immutable routing can become mandatory atomically.
TRUNCATE TABLE
  outbound_webhook_delivery_attempt,
  outbound_webhook_delivery,
  outbound_webhook_subscription,
  outbound_webhook_event,
  outbound_webhook;

-- PostgreSQL requires the referenced column set to be unique for the
-- account/channel composite foreign key below.
CREATE UNIQUE INDEX IF NOT EXISTS worker_account_worker_uidx
  ON worker (account_id, worker_id);

ALTER TABLE outbound_webhook
  ADD COLUMN channel_id uuid NOT NULL;

ALTER TABLE outbound_webhook_event
  ADD COLUMN routing_channel_ids uuid[] NOT NULL;

ALTER TABLE outbound_webhook_event
  ALTER COLUMN target_snapshot SET NOT NULL;

ALTER TABLE outbound_webhook_event
  DROP CONSTRAINT outbound_webhook_event_target_snapshot_check;

ALTER TABLE outbound_webhook_event
  ADD CONSTRAINT outbound_webhook_event_target_snapshot_check
  CHECK (
    jsonb_typeof(target_snapshot) = 'array'
    AND jsonb_array_length(target_snapshot) > 0
    AND jsonb_array_length(target_snapshot) <= 25
  );

ALTER TABLE outbound_webhook_event
  ADD CONSTRAINT outbound_webhook_event_routing_channels_check
  CHECK (
    cardinality(routing_channel_ids) > 0
    AND array_position(routing_channel_ids, NULL) IS NULL
  );

ALTER TABLE outbound_webhook
  ADD CONSTRAINT outbound_webhook_account_channel_fkey
  FOREIGN KEY (account_id, channel_id)
  REFERENCES worker (account_id, worker_id)
  ON DELETE RESTRICT;

CREATE INDEX outbound_webhook_account_channel_idx
  ON outbound_webhook (account_id, channel_id);

CREATE INDEX outbound_webhook_active_account_channel_idx
  ON outbound_webhook (account_id, channel_id)
  WHERE deleted_at IS NULL AND status = 'active';

COMMENT ON COLUMN outbound_webhook.channel_id IS
  'Single mandatory worker channel whose events this endpoint may receive.';

COMMENT ON COLUMN outbound_webhook_event.routing_channel_ids IS
  'Normalized immutable channel scope captured when the event is created.';

COMMENT ON COLUMN outbound_webhook_event.target_snapshot IS
  'Immutable webhook/config recipients filtered by routing channel before the domain mutation.';
