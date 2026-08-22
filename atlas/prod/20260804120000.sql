-- Provider-native WhatsApp status envelope. The existing implementation keeps
-- all runtime/assignment/fencing checks; this wrapper adds structural and
-- monotonic validation before an event can enter the durable outbox.

ALTER FUNCTION public.apply_worker_runtime_status(
  uuid, uuid, text, integer, uuid, text, text, jsonb, uuid
) RENAME TO apply_worker_runtime_status_fenced_internal;

REVOKE ALL ON FUNCTION public.apply_worker_runtime_status_fenced_internal(
  uuid, uuid, text, integer, uuid, text, text, jsonb, uuid
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_worker_runtime_status_fenced_internal(
  uuid, uuid, text, integer, uuid, text, text, jsonb, uuid
) FROM whatsapp_session_runtime;

CREATE INDEX "worker_runtime_event_outbox_native_status_idx"
  ON public."worker_runtime_event_outbox" (
    "worker_id", "provider", "runtime_generation", "writer_epoch",
    "outbox_id" DESC
  )
  WHERE "payload" ? 'connection_status'
    AND "payload" ? 'connection_status_source_id';

CREATE OR REPLACE FUNCTION public.apply_worker_runtime_status(
  p_worker_id uuid,
  p_account_id uuid,
  p_provider text,
  p_generation integer,
  p_writer_epoch uuid,
  p_capability text,
  p_container_id text,
  p_status jsonb,
  p_event_id uuid
)
RETURNS TABLE (
  outcome text,
  event_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_payload jsonb := p_status;
  v_status jsonb;
  v_source_id_text text;
  v_source_id uuid;
  v_native_sequence bigint;
  v_changed_at timestamptz;
  v_latest_payload jsonb;
  v_latest_status jsonb;
  v_latest_source_id text;
  v_latest_sequence bigint;
  v_latest_changed_at timestamptz;
  v_max_changed_at timestamptz;
  v_source_was_seen boolean;
  v_runtime_epoch uuid;
  v_runtime_sequence bigint;
  v_event_type text;
BEGIN
  outcome := 'invalid';
  event_id := p_event_id;

  IF p_status IS NULL OR jsonb_typeof(p_status) <> 'object' THEN
    RETURN NEXT;
    RETURN;
  END IF;

  IF (p_status ? 'connection_status') <>
     (p_status ? 'connection_status_source_id') THEN
    RETURN NEXT;
    RETURN;
  END IF;

  v_event_type := COALESCE(NULLIF(trim(p_status->>'event_type'), ''), 'status');
  IF v_event_type NOT IN ('status', 'telemetry') THEN
    RETURN NEXT;
    RETURN;
  END IF;

  IF p_status ? 'connection_status' THEN
    v_status := p_status->'connection_status';
    v_source_id_text := lower(trim(p_status->>'connection_status_source_id'));
    IF jsonb_typeof(v_status) <> 'object'
      OR jsonb_typeof(p_status->'connection_status_source_id') <> 'string'
      OR v_source_id_text !~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      OR jsonb_typeof(v_status->'provider') <> 'string'
      OR v_status->>'provider' IS DISTINCT FROM lower(trim(p_provider))
      OR jsonb_typeof(v_status->'status') <> 'string'
      OR v_status->>'status' NOT IN (
        'initializing', 'restoring', 'connecting', 'qr', 'online',
        'reconnecting', 'offline', 'logged_out', 'invalid_session',
        'conflict', 'lease_lost', 'handoff', 'stopped', 'error'
      )
      OR jsonb_typeof(v_status->'connected') <> 'boolean'
      OR jsonb_typeof(v_status->'authenticated') <> 'boolean'
      OR NOT (v_status ? 'sessionValid')
      OR jsonb_typeof(v_status->'sessionValid') NOT IN ('boolean', 'null')
      OR jsonb_typeof(v_status->'recoverable') <> 'boolean'
      OR jsonb_typeof(v_status->'qrAvailable') <> 'boolean'
      OR jsonb_typeof(v_status->'sequence') <> 'number'
      OR COALESCE(v_status->>'sequence', '') !~ '^[0-9]{1,16}$'
      OR jsonb_typeof(v_status->'changedAt') <> 'string'
      OR COALESCE(v_status->>'changedAt', '') !~
        '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,9})?Z$'
      OR (
        v_status ? 'reason'
        AND (
          jsonb_typeof(v_status->'reason') <> 'string'
          OR v_status->>'reason' !~ '^[a-z0-9][a-z0-9_.:-]{0,127}$'
        )
      )
      OR (
        v_status ? 'errorCode'
        AND (
          jsonb_typeof(v_status->'errorCode') <> 'string'
          OR v_status->>'errorCode' !~ '^[a-z0-9][a-z0-9_.:-]{0,127}$'
        )
      )
    THEN
      RETURN NEXT;
      RETURN;
    END IF;

    BEGIN
      v_source_id := v_source_id_text::uuid;
      v_native_sequence := (v_status->>'sequence')::bigint;
      v_changed_at := (v_status->>'changedAt')::timestamptz;
    EXCEPTION WHEN OTHERS THEN
      RETURN NEXT;
      RETURN;
    END;

    IF v_native_sequence > 9007199254740991 THEN
      RETURN NEXT;
      RETURN;
    END IF;

    IF (v_status->>'status' = 'online' AND NOT (
          (v_status->>'connected')::boolean
          AND (v_status->>'authenticated')::boolean
          AND v_status->'sessionValid' = 'true'::jsonb
          AND NOT (v_status->>'qrAvailable')::boolean
        ))
      OR (v_status->>'status' = 'qr' AND (
          (v_status->>'connected')::boolean
          OR (v_status->>'authenticated')::boolean
          OR NOT (v_status->>'qrAvailable')::boolean
        ))
      OR (v_status->>'status' IN (
          'offline', 'logged_out', 'invalid_session', 'conflict',
          'lease_lost', 'stopped', 'error'
        ) AND (v_status->>'connected')::boolean)
    THEN
      RETURN NEXT;
      RETURN;
    END IF;

    -- ONLINE is a two-layer acknowledgement: provider truth plus the current
    -- Kafka/runtime fence. Heartbeats or credential presence alone cannot set it.
    IF v_event_type = 'status'
      AND p_status->>'worker_status_id' =
        '019a930d-c6f6-766d-9c84-30af6ecc33b2'
      AND (
        v_status->>'status' <> 'online'
        OR p_status->'session_ready' IS DISTINCT FROM 'true'::jsonb
        OR p_status->'can_send' IS DISTINCT FROM 'true'::jsonb
        OR p_status->'can_receive_runtime' IS DISTINCT FROM 'true'::jsonb
        OR p_status->'authenticated' IS DISTINCT FROM 'true'::jsonb
        OR NULLIF(trim(p_status->>'phone'), '') IS NULL
      )
    THEN
      RETURN NEXT;
      RETURN;
    END IF;

    -- Serialize native sequence admission per channel. The inner function
    -- takes the same row lock, so this adds no second lock domain.
    PERFORM 1
    FROM public."worker"
    WHERE "worker_id" = p_worker_id AND "account_id" = p_account_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RETURN NEXT;
      RETURN;
    END IF;

    -- A validated native event is allowed to carry the current runtime epoch
    -- into the inner fence check. This lets the first factual disconnect be
    -- delivered even when the application has already cleared its local scope.
    -- Injection happens before duplicate comparison so retrying that event is
    -- idempotent even though the original application envelope omitted it.
    IF NOT (v_payload ? 'connection_epoch')
      OR NOT (v_payload ? 'connection_sequence') THEN
      SELECT runtime."connection_epoch", runtime."connection_sequence"
      INTO v_runtime_epoch, v_runtime_sequence
      FROM public."worker_runtime" AS runtime
      WHERE runtime."worker_id" = p_worker_id
        AND runtime."runtime_generation" = p_generation
        AND runtime."source_provider" = lower(trim(p_provider))
        AND runtime."session_writer_epoch" = p_writer_epoch;
      IF v_runtime_epoch IS NOT NULL AND v_runtime_sequence > 0 THEN
        v_payload := jsonb_set(
          jsonb_set(v_payload, '{connection_epoch}', to_jsonb(v_runtime_epoch::text), true),
          '{connection_sequence}', to_jsonb(v_runtime_sequence), true
        );
      END IF;
    END IF;

    SELECT outbox."payload"
    INTO v_latest_payload
    FROM public."worker_runtime_event_outbox" AS outbox
    WHERE outbox."worker_id" = p_worker_id
      AND outbox."provider" = lower(trim(p_provider))
      AND outbox."runtime_generation" = p_generation
      AND outbox."writer_epoch" = p_writer_epoch
      AND outbox."payload" ? 'connection_status'
      AND outbox."payload" ? 'connection_status_source_id'
    ORDER BY outbox."outbox_id" DESC
    LIMIT 1;

    IF v_latest_payload IS NOT NULL THEN
      v_latest_status := v_latest_payload->'connection_status';
      v_latest_source_id := lower(trim(
        v_latest_payload->>'connection_status_source_id'
      ));
      BEGIN
        v_latest_sequence := (v_latest_status->>'sequence')::bigint;
        v_latest_changed_at := (v_latest_status->>'changedAt')::timestamptz;
      EXCEPTION WHEN OTHERS THEN
        RETURN NEXT;
        RETURN;
      END;

      IF v_latest_source_id = v_source_id_text THEN
        IF v_native_sequence < v_latest_sequence THEN
          outcome := 'stale';
          RETURN NEXT;
          RETURN;
        END IF;
        IF v_native_sequence = v_latest_sequence
          AND v_latest_status <> v_status THEN
          RETURN NEXT;
          RETURN;
        END IF;
        IF v_native_sequence = v_latest_sequence
          AND v_latest_payload = v_payload THEN
          outcome := 'duplicate';
          RETURN NEXT;
          RETURN;
        END IF;
      ELSE
        SELECT EXISTS (
          SELECT 1
          FROM public."worker_runtime_event_outbox" AS historical
          WHERE historical."worker_id" = p_worker_id
            AND historical."provider" = lower(trim(p_provider))
            AND historical."runtime_generation" = p_generation
            AND historical."writer_epoch" = p_writer_epoch
            AND historical."payload" ? 'connection_status'
            AND historical."payload" ? 'connection_status_source_id'
            AND lower(trim(
              historical."payload"->>'connection_status_source_id'
            )) = v_source_id_text
        ) INTO v_source_was_seen;

        SELECT MAX((
          historical."payload"->'connection_status'->>'changedAt'
        )::timestamptz)
        INTO v_max_changed_at
        FROM public."worker_runtime_event_outbox" AS historical
        WHERE historical."worker_id" = p_worker_id
          AND historical."provider" = lower(trim(p_provider))
          AND historical."runtime_generation" = p_generation
          AND historical."writer_epoch" = p_writer_epoch
          AND historical."payload" ? 'connection_status'
          AND historical."payload" ? 'connection_status_source_id'
          AND jsonb_typeof(
            historical."payload"->'connection_status'->'changedAt'
          ) = 'string'
          AND historical."payload"->'connection_status'->>'changedAt' ~
            '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,9})?Z$';

        -- Once a source is replaced it can never come back. A brand-new
        -- source may report degradation despite a wall-clock rollback, but
        -- ONLINE is fail-closed and still requires a timestamp at or beyond
        -- the high-water mark of every source observed by this runtime.
        IF v_source_was_seen OR (
          v_status->>'status' = 'online'
          AND v_changed_at < GREATEST(
            v_latest_changed_at,
            COALESCE(v_max_changed_at, v_latest_changed_at)
          )
        ) THEN
          outcome := 'stale';
          RETURN NEXT;
          RETURN;
        END IF;
      END IF;
    END IF;

  ELSIF v_event_type = 'status'
    AND p_status->>'worker_status_id' =
      '019a930d-c6f6-766d-9c84-30af6ecc33b2' THEN
    -- Updated unofficial workers must provide native proof for ONLINE.
    RETURN NEXT;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT checked.outcome, checked.event_id
  FROM public.apply_worker_runtime_status_fenced_internal(
    p_worker_id, p_account_id, p_provider, p_generation, p_writer_epoch,
    p_capability, p_container_id, v_payload, p_event_id
  ) AS checked;
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_worker_runtime_status(
  uuid, uuid, text, integer, uuid, text, text, jsonb, uuid
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_worker_runtime_status(
  uuid, uuid, text, integer, uuid, text, text, jsonb, uuid
) TO whatsapp_session_runtime;
