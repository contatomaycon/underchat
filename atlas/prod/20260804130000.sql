-- Durable provider-native WhatsApp connection status projection.
--
-- The outbox remains the source of realtime delivery, while worker_runtime
-- stores the current, fenced projection. This avoids per-channel history
-- scans on reads and gives every browser event a server-assigned bigint order.

ALTER TABLE public."worker_runtime"
  ADD COLUMN "native_connection_status" jsonb,
  ADD COLUMN "native_connection_public_status" jsonb,
  ADD COLUMN "native_connection_status_source_id" uuid,
  ADD COLUMN "native_connection_status_sequence" bigint,
  ADD COLUMN "native_connection_status_outbox_id" bigint,
  ADD COLUMN "native_connection_status_lease_owner_id" uuid,
  ADD COLUMN "native_connection_status_fencing_token" bigint,
  ADD COLUMN "native_connection_status_changed_at_high_watermark" timestamptz,
  ADD COLUMN "native_connection_status_retired_source_ids" uuid[]
    NOT NULL DEFAULT '{}'::uuid[],
  ADD COLUMN "native_connection_online_acknowledged" boolean
    NOT NULL DEFAULT false;

ALTER TABLE public."worker_runtime"
  ADD CONSTRAINT "worker_runtime_native_connection_projection_check"
  CHECK (COALESCE((
    (
      "native_connection_status" IS NULL
      AND "native_connection_public_status" IS NULL
      AND "native_connection_status_source_id" IS NULL
      AND "native_connection_status_sequence" IS NULL
      AND "native_connection_status_outbox_id" IS NULL
      AND "native_connection_status_lease_owner_id" IS NULL
      AND "native_connection_status_fencing_token" IS NULL
      AND "native_connection_status_changed_at_high_watermark" IS NULL
      AND cardinality("native_connection_status_retired_source_ids") = 0
      AND NOT "native_connection_online_acknowledged"
    ) OR (
      jsonb_typeof("native_connection_status") = 'object'
      AND jsonb_typeof("native_connection_public_status") = 'object'
      AND "native_connection_status_source_id" IS NOT NULL
      AND "native_connection_status_sequence" BETWEEN 1 AND 9007199254740991
      AND "native_connection_status_outbox_id" > 0
      AND (
        (
          "native_connection_status_lease_owner_id" IS NULL
          AND "native_connection_status_fencing_token" IS NULL
        ) OR (
          "native_connection_status_lease_owner_id" IS NOT NULL
          AND "native_connection_status_fencing_token" > 0
        )
      )
      AND "native_connection_status_changed_at_high_watermark" IS NOT NULL
      AND "native_connection_public_status" ->> 'provider' =
        "source_provider"
      AND "native_connection_public_status" ->> 'sequence' =
        "native_connection_status_sequence"::text
      AND jsonb_typeof(
        "native_connection_public_status" -> 'status'
      ) = 'string'
      AND jsonb_typeof(
        "native_connection_public_status" -> 'connected'
      ) = 'boolean'
      AND jsonb_typeof(
        "native_connection_public_status" -> 'authenticated'
      ) = 'boolean'
      AND jsonb_typeof(
        "native_connection_public_status" -> 'sessionValid'
      ) IN ('boolean', 'null')
      AND jsonb_typeof(
        "native_connection_public_status" -> 'recoverable'
      ) = 'boolean'
      AND jsonb_typeof(
        "native_connection_public_status" -> 'qrAvailable'
      ) = 'boolean'
      AND "native_connection_public_status" ->> 'changedAt' ~
        '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,9})?Z$'
      AND array_position(
        "native_connection_status_retired_source_ids",
        NULL
      ) IS NULL
      AND NOT (
        "native_connection_status_source_id" = ANY(
          "native_connection_status_retired_source_ids"
        )
      )
    )
  ), false)),
  ADD CONSTRAINT "worker_runtime_native_connection_ack_check"
  CHECK (COALESCE((
    NOT "native_connection_online_acknowledged"
    OR (
      jsonb_typeof("native_connection_status" -> 'provider') = 'string'
      AND "native_connection_status" ->> 'provider' = "source_provider"
      AND "native_connection_status" ->> 'status' = 'online'
      AND "native_connection_status" -> 'connected' = 'true'::jsonb
      AND "native_connection_status" -> 'authenticated' = 'true'::jsonb
      AND "native_connection_status" -> 'sessionValid' = 'true'::jsonb
      AND jsonb_typeof(
        "native_connection_status" -> 'recoverable'
      ) = 'boolean'
      AND "native_connection_status" -> 'qrAvailable' = 'false'::jsonb
      AND jsonb_typeof(
        "native_connection_status" -> 'sequence'
      ) = 'number'
      AND "native_connection_status" ->> 'sequence' =
        "native_connection_status_sequence"::text
      AND jsonb_typeof(
        "native_connection_status" -> 'changedAt'
      ) = 'string'
      AND "native_connection_status" ->> 'changedAt' ~
        '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,9})?Z$'
      AND (
        (
          "session_storage" = 'legacy_volume'
          AND "native_connection_status_lease_owner_id" IS NULL
          AND "native_connection_status_fencing_token" IS NULL
        ) OR (
          "session_storage" = 'postgres'
          AND "native_connection_status_lease_owner_id" IS NOT NULL
          AND "native_connection_status_fencing_token" > 0
        )
      )
    )
  ), false));

-- A new writer/runtime fence must never inherit an ONLINE acknowledgement
-- from the previous provider, generation, writer, connection or backend.
CREATE OR REPLACE FUNCTION public.reset_worker_runtime_native_connection_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF OLD."runtime_generation" IS DISTINCT FROM NEW."runtime_generation"
    OR OLD."source_provider" IS DISTINCT FROM NEW."source_provider"
    OR OLD."session_writer_epoch" IS DISTINCT FROM NEW."session_writer_epoch"
    OR OLD."connection_epoch" IS DISTINCT FROM NEW."connection_epoch"
    OR OLD."connection_sequence" IS DISTINCT FROM NEW."connection_sequence"
    OR OLD."session_storage" IS DISTINCT FROM NEW."session_storage"
  THEN
    NEW."native_connection_status" := NULL;
    NEW."native_connection_public_status" := NULL;
    NEW."native_connection_status_source_id" := NULL;
    NEW."native_connection_status_sequence" := NULL;
    NEW."native_connection_status_outbox_id" := NULL;
    NEW."native_connection_status_lease_owner_id" := NULL;
    NEW."native_connection_status_fencing_token" := NULL;
    NEW."native_connection_status_changed_at_high_watermark" := NULL;
    NEW."native_connection_status_retired_source_ids" := '{}'::uuid[];
    NEW."native_connection_online_acknowledged" := false;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.reset_worker_runtime_native_connection_v1()
  FROM PUBLIC;

CREATE TRIGGER "worker_runtime_native_connection_reset_trg"
BEFORE UPDATE ON public."worker_runtime"
FOR EACH ROW
EXECUTE FUNCTION public.reset_worker_runtime_native_connection_v1();

-- Reconciliation deliberately invalidates ONLINE during the same five-second
-- safety margin used by API reads. Once a renewal enters that margin, it must
-- fail rather than extending the same token after its public ACK was cleared.
-- A fresh acquire increments fencing_token and remains allowed.
CREATE OR REPLACE FUNCTION public.reject_late_whatsapp_lease_renewal_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF OLD."owner_id" IS NOT NULL
    AND NEW."owner_id" IS NOT DISTINCT FROM OLD."owner_id"
    AND NEW."fencing_token" = OLD."fencing_token"
    AND NEW."expires_at" > OLD."expires_at"
    AND OLD."expires_at" <= clock_timestamp() + interval '5 seconds'
  THEN
    RAISE EXCEPTION 'whatsapp session lease entered the renewal safety margin'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.reject_late_whatsapp_lease_renewal_v1()
  FROM PUBLIC;

CREATE TRIGGER "whatsapp_session_lease_late_renewal_guard_trg"
BEFORE UPDATE OF "heartbeat_at", "expires_at"
ON public."whatsapp_session_lease"
FOR EACH ROW
EXECUTE FUNCTION public.reject_late_whatsapp_lease_renewal_v1();

-- Preserve the accepted source lineage once. Hot-path admission below reads
-- only worker_runtime; retention/cleanup of the outbox cannot resurrect a
-- retired native process.
WITH raw_native AS MATERIALIZED (
  SELECT outbox.*
  FROM public."worker_runtime_event_outbox" AS outbox
  JOIN public."worker_runtime" AS runtime
    ON runtime."worker_id" = outbox."worker_id"
   AND runtime."runtime_generation" = outbox."runtime_generation"
   AND runtime."source_provider" = outbox."provider"
   AND runtime."session_writer_epoch" = outbox."writer_epoch"
   AND runtime."connection_sequence" = outbox."connection_sequence"
  WHERE outbox."payload" ? 'connection_status'
    AND outbox."payload" ? 'connection_status_source_id'
    AND jsonb_typeof(outbox."payload" -> 'connection_status') = 'object'
    AND jsonb_typeof(
      outbox."payload" -> 'connection_status' -> 'provider'
    ) = 'string'
    AND outbox."payload" -> 'connection_status' ->> 'provider' =
      outbox."provider"
    AND jsonb_typeof(
      outbox."payload" -> 'connection_status' -> 'status'
    ) = 'string'
    AND outbox."payload" -> 'connection_status' ->> 'status' IN (
      'initializing', 'restoring', 'connecting', 'qr', 'online',
      'reconnecting', 'offline', 'logged_out', 'invalid_session',
      'conflict', 'lease_lost', 'handoff', 'stopped', 'error'
    )
    AND jsonb_typeof(
      outbox."payload" -> 'connection_status' -> 'connected'
    ) = 'boolean'
    AND jsonb_typeof(
      outbox."payload" -> 'connection_status' -> 'authenticated'
    ) = 'boolean'
    AND outbox."payload" -> 'connection_status' ? 'sessionValid'
    AND jsonb_typeof(
      outbox."payload" -> 'connection_status' -> 'sessionValid'
    ) IN ('boolean', 'null')
    AND jsonb_typeof(
      outbox."payload" -> 'connection_status' -> 'recoverable'
    ) = 'boolean'
    AND jsonb_typeof(
      outbox."payload" -> 'connection_status' -> 'qrAvailable'
    ) = 'boolean'
    AND jsonb_typeof(
      outbox."payload" -> 'connection_status' -> 'sequence'
    ) = 'number'
    AND outbox."payload" -> 'connection_status' ->> 'sequence'
      ~ '^[1-9][0-9]{0,15}$'
    AND (outbox."payload" -> 'connection_status' ->> 'sequence')::numeric
      <= 9007199254740991
    AND jsonb_typeof(
      outbox."payload" -> 'connection_status' -> 'changedAt'
    ) = 'string'
    AND outbox."payload" -> 'connection_status' ->> 'changedAt' ~
      '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,9})?Z$'
    AND lower(trim(outbox."payload" ->> 'connection_status_source_id')) ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    AND (
      NOT (outbox."payload" -> 'connection_status' ? 'reason')
      OR (
        jsonb_typeof(
          outbox."payload" -> 'connection_status' -> 'reason'
        ) = 'string'
        AND outbox."payload" -> 'connection_status' ->> 'reason' ~
          '^[a-z0-9][a-z0-9_.:-]{0,127}$'
      )
    )
    AND (
      NOT (outbox."payload" -> 'connection_status' ? 'errorCode')
      OR (
        jsonb_typeof(
          outbox."payload" -> 'connection_status' -> 'errorCode'
        ) = 'string'
        AND outbox."payload" -> 'connection_status' ->> 'errorCode' ~
          '^[a-z0-9][a-z0-9_.:-]{0,127}$'
      )
    )
    AND NOT (
      (
        outbox."payload" -> 'connection_status' ->> 'status' = 'online'
        AND (
          outbox."payload" -> 'connection_status' -> 'connected'
            IS DISTINCT FROM 'true'::jsonb
          OR outbox."payload" -> 'connection_status' -> 'authenticated'
            IS DISTINCT FROM 'true'::jsonb
          OR outbox."payload" -> 'connection_status' -> 'sessionValid'
            IS DISTINCT FROM 'true'::jsonb
          OR outbox."payload" -> 'connection_status' -> 'qrAvailable'
            IS DISTINCT FROM 'false'::jsonb
        )
      ) OR (
        outbox."payload" -> 'connection_status' ->> 'status' = 'qr'
        AND (
          outbox."payload" -> 'connection_status' -> 'connected' =
            'true'::jsonb
          OR outbox."payload" -> 'connection_status' -> 'authenticated' =
            'true'::jsonb
          OR outbox."payload" -> 'connection_status' -> 'qrAvailable'
            IS DISTINCT FROM 'true'::jsonb
        )
      ) OR (
        outbox."payload" -> 'connection_status' ->> 'status' IN (
          'offline', 'logged_out', 'invalid_session', 'conflict',
          'lease_lost', 'stopped', 'error'
        )
        AND outbox."payload" -> 'connection_status' -> 'connected' =
          'true'::jsonb
      )
    )
), valid_native AS MATERIALIZED (
  SELECT raw.*,
    (raw."payload" ->> 'connection_status_source_id')::uuid AS source_id,
    (raw."payload" -> 'connection_status' ->> 'sequence')::bigint
      AS native_sequence,
    (raw."payload" -> 'connection_status' ->> 'changedAt')::timestamptz
      AS changed_at
  FROM raw_native AS raw
), native_lineage AS (
  SELECT valid."worker_id",
    array_agg(DISTINCT valid.source_id ORDER BY valid.source_id) AS source_ids,
    max(valid.changed_at) AS changed_at_high_watermark
  FROM valid_native AS valid
  GROUP BY valid."worker_id"
), latest_native AS (
  SELECT DISTINCT ON (valid."worker_id")
    valid.*,
    worker."worker_status_id",
    worker."session_storage"
  FROM valid_native AS valid
  JOIN public."worker" AS worker
    ON worker."worker_id" = valid."worker_id"
  ORDER BY valid."worker_id", valid."outbox_id" DESC
)
UPDATE public."worker_runtime" AS runtime
SET "native_connection_status" = latest."payload" -> 'connection_status',
    "native_connection_public_status" =
      latest."payload" -> 'connection_status',
    "native_connection_status_source_id" = latest."source_id",
    "native_connection_status_sequence" = latest."native_sequence",
    "native_connection_status_outbox_id" = latest."outbox_id",
    "native_connection_status_lease_owner_id" = NULL,
    "native_connection_status_fencing_token" = NULL,
    "native_connection_status_changed_at_high_watermark" =
      lineage.changed_at_high_watermark,
    "native_connection_status_retired_source_ids" =
      array_remove(lineage.source_ids, latest."source_id"),
    "native_connection_online_acknowledged" = (
      latest."event_type" = 'status'
      AND latest."payload" ->> 'worker_status_id' =
        '019a930d-c6f6-766d-9c84-30af6ecc33b2'
      AND latest."payload" -> 'connection_status' ->> 'status' = 'online'
      AND latest."payload" -> 'session_ready' = 'true'::jsonb
      AND latest."payload" -> 'can_send' = 'true'::jsonb
      AND latest."payload" -> 'can_receive_runtime' = 'true'::jsonb
      AND latest."payload" -> 'authenticated' = 'true'::jsonb
      AND NULLIF(trim(latest."payload" ->> 'phone'), '') IS NOT NULL
      AND latest."worker_status_id" =
        '019a930d-c6f6-766d-9c84-30af6ecc33b2'::uuid
      -- Historical rows did not carry the exact owner/token proof. PostgreSQL
      -- sessions therefore fail closed until their next native ONLINE event.
      AND latest."session_storage" <> 'postgres'
    ),
    "updated_at" = clock_timestamp()
FROM latest_native AS latest
JOIN native_lineage AS lineage
  ON lineage."worker_id" = latest."worker_id"
WHERE runtime."worker_id" = latest."worker_id";

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
  -- Lease identity is an admission capability, never public telemetry. Keep it
  -- in local variables and remove it before the inner function/outbox sees it.
  v_payload jsonb := p_status
    - 'connection_status_lease_owner_id'
    - 'connection_status_fencing_token';
  v_status jsonb;
  v_source_id_text text;
  v_source_id uuid;
  v_native_sequence bigint;
  v_changed_at timestamptz;
  v_lease_owner_id_text text;
  v_lease_owner_id uuid;
  v_fencing_token bigint;
  v_runtime_epoch text;
  v_runtime_sequence bigint;
  v_preflight_storage text;
  v_runtime_storage text;
  v_current_native_status jsonb;
  v_current_native_source_id uuid;
  v_current_native_sequence bigint;
  v_current_native_lease_owner_id uuid;
  v_current_native_fencing_token bigint;
  v_current_native_online_acknowledged boolean;
  v_changed_at_high_watermark timestamptz;
  v_retired_source_ids uuid[];
  v_event_type text;
  v_current_worker_status_id uuid;
  v_current_worker_number text;
  v_current_worker_container_id text;
  v_current_worker_connection_date timestamptz;
  v_lifecycle_operation_id uuid;
  v_strong_online_requested boolean := false;
  v_business_mutation_pending boolean := false;
  v_live_lease boolean := false;
  v_inner_outcome text;
  v_inner_event_id uuid;
  v_outbox_id bigint;
  v_should_downgrade boolean := false;
  v_online_acknowledged boolean := false;
BEGIN
  outcome := 'invalid';
  event_id := p_event_id;

  IF p_status IS NULL OR jsonb_typeof(p_status) <> 'object' THEN
    RETURN NEXT;
    RETURN;
  END IF;

  IF (p_status ? 'connection_status_lease_owner_id') <>
     (p_status ? 'connection_status_fencing_token') THEN
    RETURN NEXT;
    RETURN;
  END IF;

  IF p_status ? 'connection_status_lease_owner_id' THEN
    v_lease_owner_id_text := lower(trim(
      p_status ->> 'connection_status_lease_owner_id'
    ));
    IF jsonb_typeof(p_status -> 'connection_status_lease_owner_id') <>
        'string'
      OR v_lease_owner_id_text !~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      OR jsonb_typeof(p_status -> 'connection_status_fencing_token')
        NOT IN ('number', 'string')
      OR COALESCE(p_status ->> 'connection_status_fencing_token', '') !~
        '^[1-9][0-9]{0,18}$'
    THEN
      RETURN NEXT;
      RETURN;
    END IF;
    BEGIN
      v_lease_owner_id := v_lease_owner_id_text::uuid;
      v_fencing_token :=
        (p_status ->> 'connection_status_fencing_token')::bigint;
    EXCEPTION WHEN OTHERS THEN
      RETURN NEXT;
      RETURN;
    END;
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
      OR COALESCE(v_status->>'sequence', '') !~ '^[1-9][0-9]{0,15}$'
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

    -- Rebuild the browser/database envelope from the allowlist. Validation
    -- alone is insufficient because a compromised runtime could append a QR,
    -- cookie, token or profile under an otherwise valid canonical snapshot.
    v_status := jsonb_build_object(
      'provider', v_status -> 'provider',
      'status', v_status -> 'status',
      'connected', v_status -> 'connected',
      'authenticated', v_status -> 'authenticated',
      'sessionValid', v_status -> 'sessionValid',
      'recoverable', v_status -> 'recoverable',
      'qrAvailable', v_status -> 'qrAvailable',
      'sequence', v_status -> 'sequence',
      'changedAt', v_status -> 'changedAt'
    ) || CASE
      WHEN p_status->'connection_status' ? 'reason'
        THEN jsonb_build_object(
          'reason', p_status->'connection_status' -> 'reason'
        )
      ELSE '{}'::jsonb
    END || CASE
      WHEN p_status->'connection_status' ? 'errorCode'
        THEN jsonb_build_object(
          'errorCode', p_status->'connection_status' -> 'errorCode'
        )
      ELSE '{}'::jsonb
    END;
    v_payload := jsonb_set(
      v_payload, '{connection_status}', v_status, true
    );

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

    IF v_status->>'status' = 'online' AND v_event_type = 'status' THEN
      IF p_status->>'worker_status_id' <>
          '019a930d-c6f6-766d-9c84-30af6ecc33b2'
        OR p_status->'session_ready' IS DISTINCT FROM 'true'::jsonb
        OR p_status->'can_send' IS DISTINCT FROM 'true'::jsonb
        OR p_status->'can_receive_runtime' IS DISTINCT FROM 'true'::jsonb
        OR p_status->'authenticated' IS DISTINCT FROM 'true'::jsonb
        OR NULLIF(trim(p_status->>'phone'), '') IS NULL
      THEN
        RETURN NEXT;
        RETURN;
      END IF;
      v_strong_online_requested := true;
    END IF;

    -- The event kind is authoritative. Native listeners emit telemetry and
    -- may only perform the conservative ONLINE -> OFFLINE fallback below.
    -- Provider business callbacks emit status and must retain their target
    -- state/disconnected_user semantics (logged-out, conflict, mismatched,
    -- available, number cleanup, and so on).
    IF v_event_type = 'telemetry' THEN
      v_payload := v_payload - 'worker_status_id' - 'disconnected_user';
    END IF;

    -- This first read is deliberately non-locking and decides whether ONLINE
    -- needs a lease. Authoritative locks below follow the control-plane order
    -- worker -> runtime -> lease used by activation and handoff recovery.
    SELECT runtime."session_storage"
    INTO v_preflight_storage
    FROM public."worker_runtime" AS runtime
    WHERE runtime."worker_id" = p_worker_id
      AND runtime."runtime_generation" = p_generation
      AND runtime."source_provider" = lower(trim(p_provider))
      AND runtime."session_writer_epoch" = p_writer_epoch;

    IF v_preflight_storage = 'legacy_volume'
      AND (v_lease_owner_id IS NOT NULL OR v_fencing_token IS NOT NULL)
    THEN
      -- Volume sessions do not participate in the PostgreSQL lease contract.
      RETURN NEXT;
      RETURN;
    END IF;
    IF v_strong_online_requested
      AND v_preflight_storage = 'postgres'
      AND (v_lease_owner_id IS NULL OR v_fencing_token IS NULL)
    THEN
      RETURN NEXT;
      RETURN;
    END IF;

    SELECT w."worker_status_id", w."number", w."container_id",
      w."connection_date", w."lifecycle_operation_id"
    INTO v_current_worker_status_id, v_current_worker_number,
      v_current_worker_container_id, v_current_worker_connection_date,
      v_lifecycle_operation_id
    FROM public."worker" AS w
    WHERE w."worker_id" = p_worker_id
      AND w."account_id" = p_account_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RETURN NEXT;
      RETURN;
    END IF;

    SELECT runtime."connection_epoch",
      runtime."connection_sequence",
      runtime."session_storage",
      runtime."native_connection_status",
      runtime."native_connection_status_source_id",
      runtime."native_connection_status_sequence",
      runtime."native_connection_status_lease_owner_id",
      runtime."native_connection_status_fencing_token",
      runtime."native_connection_online_acknowledged",
      runtime."native_connection_status_changed_at_high_watermark",
      runtime."native_connection_status_retired_source_ids"
    INTO v_runtime_epoch, v_runtime_sequence, v_runtime_storage,
      v_current_native_status, v_current_native_source_id,
      v_current_native_sequence, v_current_native_lease_owner_id,
      v_current_native_fencing_token,
      v_current_native_online_acknowledged,
      v_changed_at_high_watermark, v_retired_source_ids
    FROM public."worker_runtime" AS runtime
    WHERE runtime."worker_id" = p_worker_id
      AND runtime."runtime_generation" = p_generation
      AND runtime."source_provider" = lower(trim(p_provider))
      AND runtime."session_writer_epoch" = p_writer_epoch
    FOR UPDATE;
    IF NOT FOUND THEN
      outcome := 'stale';
      RETURN NEXT;
      RETURN;
    END IF;

    IF v_runtime_storage IS DISTINCT FROM v_preflight_storage THEN
      RAISE EXCEPTION 'runtime session backend changed during status admission'
        USING ERRCODE = '40001';
    END IF;

    IF v_strong_online_requested AND v_runtime_storage = 'postgres' THEN
      PERFORM 1
      FROM public."whatsapp_session_lease" AS lease
      WHERE lease."session_id" = p_worker_id
        AND lease."provider" = lower(trim(p_provider))
        AND lease."generation" = p_generation
        AND lease."epoch" = p_writer_epoch
        AND lease."owner_id" = v_lease_owner_id
        AND lease."fencing_token" = v_fencing_token
        AND lease."expires_at" > clock_timestamp() + interval '5 seconds'
      FOR SHARE;
      v_live_lease := FOUND;
      IF NOT v_live_lease THEN
        RETURN NEXT;
        RETURN;
      END IF;
    ELSIF v_runtime_storage = 'legacy_volume' THEN
      v_live_lease := true;
    END IF;

    IF (NOT (v_payload ? 'connection_epoch')
        OR NOT (v_payload ? 'connection_sequence'))
      AND v_runtime_epoch IS NOT NULL
      AND v_runtime_sequence > 0
    THEN
      v_payload := jsonb_set(
        jsonb_set(
          v_payload, '{connection_epoch}',
          to_jsonb(v_runtime_epoch::text), true
        ),
        '{connection_sequence}', to_jsonb(v_runtime_sequence), true
      );
    END IF;

    v_retired_source_ids := COALESCE(v_retired_source_ids, '{}'::uuid[]);
    IF v_source_id = ANY(v_retired_source_ids) THEN
      outcome := 'stale';
      RETURN NEXT;
      RETURN;
    END IF;

    IF v_status->>'status' = 'online'
      AND v_changed_at_high_watermark IS NOT NULL
      AND v_changed_at < v_changed_at_high_watermark
    THEN
      outcome := 'stale';
      RETURN NEXT;
      RETURN;
    END IF;

    v_business_mutation_pending :=
      v_event_type = 'status'
      AND v_status->>'status' <> 'online'
      AND (
        NULLIF(trim(v_payload->>'worker_status_id'), '') IS DISTINCT FROM
          v_current_worker_status_id::text
        OR (
          lower(COALESCE(v_payload->>'disconnected_user', 'false')) = 'true'
          AND (
            v_current_worker_number IS NOT NULL
            OR v_current_worker_container_id IS NOT NULL
            OR v_current_worker_connection_date IS NOT NULL
          )
        )
        OR (
          NULLIF(trim(v_payload->>'phone'), '') IS NOT NULL
          AND v_payload->>'worker_status_id' <>
            '019a930d-c6f6-766d-9c84-3904383fe742'
          AND NULLIF(trim(v_payload->>'phone'), '') IS DISTINCT FROM
            v_current_worker_number
        )
      );

    IF v_current_native_source_id = v_source_id THEN
      IF v_native_sequence < v_current_native_sequence THEN
        outcome := 'stale';
        RETURN NEXT;
        RETURN;
      END IF;
      IF v_native_sequence = v_current_native_sequence
        AND v_current_native_status <> v_status
      THEN
        RETURN NEXT;
        RETURN;
      END IF;
      IF v_native_sequence = v_current_native_sequence
        AND v_current_native_status = v_status
        AND NOT (
          v_strong_online_requested
          AND (
            NOT COALESCE(v_current_native_online_acknowledged, false)
            OR v_current_native_lease_owner_id IS DISTINCT FROM
              v_lease_owner_id
            OR v_current_native_fencing_token IS DISTINCT FROM
              v_fencing_token
          )
          OR v_business_mutation_pending
        )
      THEN
        -- Native telemetry is normally followed by the business notification.
        -- Persist only one row for an identical fact. Exceptions are a strong
        -- ONLINE acknowledgement and a non-ONLINE business callback that still
        -- has an actual worker mutation to apply.
        outcome := 'duplicate';
        RETURN NEXT;
        RETURN;
      END IF;
    END IF;

  ELSIF v_event_type = 'status'
    AND p_status->>'worker_status_id' =
      '019a930d-c6f6-766d-9c84-30af6ecc33b2'
  THEN
    -- Unofficial providers cannot assert ONLINE without native proof.
    RETURN NEXT;
    RETURN;
  ELSIF v_event_type = 'telemetry' THEN
    -- Telemetry is never allowed to project an uncommitted business status in
    -- the browser. The inner function already treats it as non-mutating; make
    -- the persisted payload match that semantic contract as well.
    v_payload := v_payload - 'worker_status_id' - 'disconnected_user';
  END IF;

  SELECT checked.outcome, checked.event_id
  INTO v_inner_outcome, v_inner_event_id
  FROM public.apply_worker_runtime_status_fenced_internal(
    p_worker_id, p_account_id, p_provider, p_generation, p_writer_epoch,
    p_capability, p_container_id, v_payload, p_event_id
  ) AS checked;

  outcome := COALESCE(v_inner_outcome, 'invalid');
  event_id := COALESCE(v_inner_event_id, p_event_id);

  IF outcome <> 'applied' OR v_status IS NULL THEN
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT outbox."outbox_id"
  INTO v_outbox_id
  FROM public."worker_runtime_event_outbox" AS outbox
  WHERE outbox."event_id" = COALESCE(v_inner_event_id, p_event_id)
    AND outbox."worker_id" = p_worker_id;
  IF v_outbox_id IS NULL THEN
    RAISE EXCEPTION 'native status outbox row was not materialized'
      USING ERRCODE = '40001';
  END IF;

  v_should_downgrade :=
    v_event_type = 'telemetry'
    AND v_status->>'status' <> 'online'
    AND v_current_worker_status_id =
      '019a930d-c6f6-766d-9c84-30af6ecc33b2'::uuid
    AND v_lifecycle_operation_id IS NULL;

  IF v_should_downgrade THEN
    UPDATE public."worker" AS w
    SET "worker_status_id" =
          '019a930d-c6f6-766d-9c84-3696c2cd5ed8'::uuid,
        "updated_at" = clock_timestamp()
    WHERE w."worker_id" = p_worker_id
      AND w."account_id" = p_account_id
      AND w."worker_status_id" =
        '019a930d-c6f6-766d-9c84-30af6ecc33b2'::uuid
      AND w."lifecycle_operation_id" IS NULL;

    IF FOUND THEN
      v_payload := jsonb_set(
        jsonb_set(
          v_payload, '{event_type}', '"status"'::jsonb, true
        ),
        '{worker_status_id}',
        to_jsonb('019a930d-c6f6-766d-9c84-3696c2cd5ed8'::text),
        true
      );
      UPDATE public."worker_runtime_event_outbox" AS outbox
      SET "event_type" = 'status', "payload" = v_payload
      WHERE outbox."outbox_id" = v_outbox_id;
    END IF;
  END IF;

  -- FOR SHARE prevents owner/takeover changes, but PostgreSQL time can still
  -- cross expires_at while the inner function runs. Revalidate immediately
  -- before acknowledging ONLINE; failure rolls back the worker row and outbox.
  IF v_strong_online_requested AND v_runtime_storage = 'postgres' THEN
    PERFORM 1
    FROM public."whatsapp_session_lease" AS lease
    WHERE lease."session_id" = p_worker_id
      AND lease."provider" = lower(trim(p_provider))
      AND lease."generation" = p_generation
      AND lease."epoch" = p_writer_epoch
      AND lease."owner_id" = v_lease_owner_id
      AND lease."fencing_token" = v_fencing_token
      AND lease."expires_at" > clock_timestamp() + interval '5 seconds';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'whatsapp session lease expired before online ack'
        USING ERRCODE = '40001';
    END IF;
    v_live_lease := true;
  END IF;

  UPDATE public."worker_runtime" AS runtime
  SET "native_connection_status" = v_status,
      "native_connection_public_status" = v_status,
      "native_connection_status_source_id" = v_source_id,
      "native_connection_status_sequence" = v_native_sequence,
      "native_connection_status_outbox_id" = v_outbox_id,
      "native_connection_status_lease_owner_id" = CASE
        WHEN v_status->>'status' = 'online'
          AND v_runtime_storage = 'postgres'
          AND v_strong_online_requested
          AND v_live_lease
          THEN v_lease_owner_id
        WHEN v_status->>'status' = 'online'
          AND v_runtime_storage = 'postgres'
          AND runtime."native_connection_status_source_id" = v_source_id
          AND runtime."native_connection_status_sequence" = v_native_sequence
          AND runtime."native_connection_online_acknowledged"
          THEN runtime."native_connection_status_lease_owner_id"
        ELSE NULL
      END,
      "native_connection_status_fencing_token" = CASE
        WHEN v_status->>'status' = 'online'
          AND v_runtime_storage = 'postgres'
          AND v_strong_online_requested
          AND v_live_lease
          THEN v_fencing_token
        WHEN v_status->>'status' = 'online'
          AND v_runtime_storage = 'postgres'
          AND runtime."native_connection_status_source_id" = v_source_id
          AND runtime."native_connection_status_sequence" = v_native_sequence
          AND runtime."native_connection_online_acknowledged"
          THEN runtime."native_connection_status_fencing_token"
        ELSE NULL
      END,
      "native_connection_status_changed_at_high_watermark" = GREATEST(
        COALESCE(
          runtime."native_connection_status_changed_at_high_watermark",
          v_changed_at
        ),
        v_changed_at
      ),
      "native_connection_status_retired_source_ids" = CASE
        WHEN runtime."native_connection_status_source_id" IS NULL
          OR runtime."native_connection_status_source_id" = v_source_id
          THEN runtime."native_connection_status_retired_source_ids"
        WHEN runtime."native_connection_status_source_id" = ANY(
          runtime."native_connection_status_retired_source_ids"
        ) THEN runtime."native_connection_status_retired_source_ids"
        ELSE array_append(
          runtime."native_connection_status_retired_source_ids",
          runtime."native_connection_status_source_id"
        )
      END,
      "native_connection_online_acknowledged" = CASE
        WHEN v_status->>'status' <> 'online' THEN false
        WHEN runtime."native_connection_status_source_id" = v_source_id
          AND runtime."native_connection_status_sequence" = v_native_sequence
          AND runtime."native_connection_online_acknowledged"
          THEN true
        WHEN v_strong_online_requested
          AND (v_runtime_storage = 'legacy_volume' OR v_live_lease)
          THEN true
        ELSE false
      END,
      "updated_at" = clock_timestamp()
  WHERE runtime."worker_id" = p_worker_id
    AND runtime."runtime_generation" = p_generation
    AND runtime."source_provider" = lower(trim(p_provider))
    AND runtime."session_writer_epoch" = p_writer_epoch
    AND runtime."connection_sequence" = v_runtime_sequence
  RETURNING runtime."native_connection_online_acknowledged"
  INTO v_online_acknowledged;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'native status runtime projection fence changed'
      USING ERRCODE = '40001';
  END IF;

  v_payload := jsonb_set(
    jsonb_set(
      v_payload,
      '{connection_status_order}',
      to_jsonb(v_outbox_id::text),
      true
    ),
    '{connection_online_acknowledged}',
    to_jsonb(v_online_acknowledged),
    true
  );
  UPDATE public."worker_runtime_event_outbox" AS outbox
  SET "payload" = v_payload
  WHERE outbox."outbox_id" = v_outbox_id;

  RETURN NEXT;
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_worker_runtime_status(
  uuid, uuid, text, integer, uuid, text, text, jsonb, uuid
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_worker_runtime_status(
  uuid, uuid, text, integer, uuid, text, text, jsonb, uuid
) TO whatsapp_session_runtime;

-- A provider process can disappear without delivering its terminal callback.
-- Reconcile the durable proof centrally so already-open browsers cannot keep
-- displaying the last published ONLINE after the exact fenced lease is gone.
-- The native snapshot/source/sequence remain untouched: a restarted provider
-- may re-acknowledge the same native fact with a new owner/token.
CREATE OR REPLACE FUNCTION public.reconcile_expired_whatsapp_online_acks(
  p_limit integer DEFAULT 100,
  p_lease_margin_ms integer DEFAULT 5000
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_candidate record;
  v_lease public.whatsapp_session_lease%ROWTYPE;
  v_worker public.worker%ROWTYPE;
  v_runtime public.worker_runtime%ROWTYPE;
  v_observed_at timestamptz;
  v_final_worker_status_id uuid;
  v_outbox_event_type text;
  v_public_status jsonb;
  v_payload jsonb;
  v_outbox_id bigint;
  v_updated integer;
  v_reconciled integer := 0;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 1000
    OR p_lease_margin_ms IS NULL
    OR p_lease_margin_ms < 0
    OR p_lease_margin_ms > 30000
  THEN
    RAISE EXCEPTION 'invalid online acknowledgement reconciliation bounds'
      USING ERRCODE = '22023';
  END IF;

  FOR v_candidate IN
    SELECT runtime."worker_id"
    FROM public."worker_runtime" AS runtime
    JOIN public."worker" AS worker
      ON worker."worker_id" = runtime."worker_id"
     AND worker."deleted_at" IS NULL
    JOIN public."whatsapp_session_lease" AS lease
      ON lease."session_id" = runtime."worker_id"
    WHERE runtime."session_storage" = 'postgres'
      AND runtime."native_connection_online_acknowledged"
      AND NOT COALESCE((
        lease."provider" = runtime."source_provider"
        AND lease."generation" = runtime."runtime_generation"
        AND lease."epoch" = runtime."session_writer_epoch"
        AND lease."owner_id" =
          runtime."native_connection_status_lease_owner_id"
        AND lease."fencing_token" =
          runtime."native_connection_status_fencing_token"
        AND lease."expires_at" > clock_timestamp()
          + (p_lease_margin_ms::double precision * interval '1 millisecond')
      ), false)
    ORDER BY runtime."worker_id"
    LIMIT p_limit
    FOR UPDATE OF worker SKIP LOCKED
  LOOP
    -- Match the global control-plane order: worker -> runtime -> lease. The
    -- first SKIP LOCKED makes concurrent reconcilers bounded without creating
    -- the lease -> worker cycle used by handoff recovery.
    SELECT worker.*
    INTO v_worker
    FROM public."worker" AS worker
    WHERE worker."worker_id" = v_candidate."worker_id"
      AND worker."deleted_at" IS NULL
    FOR UPDATE;
    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    SELECT runtime.*
    INTO v_runtime
    FROM public."worker_runtime" AS runtime
    WHERE runtime."worker_id" = v_candidate."worker_id"
    FOR UPDATE;
    IF NOT FOUND
      OR v_runtime."session_storage" <> 'postgres'
      OR NOT v_runtime."native_connection_online_acknowledged"
    THEN
      CONTINUE;
    END IF;

    SELECT lease.*
    INTO v_lease
    FROM public."whatsapp_session_lease" AS lease
    WHERE lease."session_id" = v_candidate."worker_id"
    FOR UPDATE;
    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    v_observed_at := clock_timestamp();
    IF COALESCE((
      v_lease."provider" = v_runtime."source_provider"
      AND v_lease."generation" = v_runtime."runtime_generation"
      AND v_lease."epoch" = v_runtime."session_writer_epoch"
      AND v_lease."owner_id" =
        v_runtime."native_connection_status_lease_owner_id"
      AND v_lease."fencing_token" =
        v_runtime."native_connection_status_fencing_token"
      AND v_lease."expires_at" > v_observed_at
        + (p_lease_margin_ms::double precision * interval '1 millisecond')
    ), false) THEN
      CONTINUE;
    END IF;

    -- Publish a fail-closed, customer-safe fact without destroying the last
    -- native snapshot. Keeping the provider sequence untouched allows the
    -- same native ONLINE fact to be strongly re-acknowledged after takeover.
    v_public_status := jsonb_build_object(
      'provider', v_runtime."native_connection_status" -> 'provider',
      'status', 'lease_lost',
      'connected', false,
      'authenticated',
        v_runtime."native_connection_status" -> 'authenticated',
      'sessionValid',
        v_runtime."native_connection_status" -> 'sessionValid',
      'recoverable',
        v_runtime."native_connection_status" -> 'recoverable',
      'qrAvailable', false,
      'sequence', v_runtime."native_connection_status" -> 'sequence',
      'changedAt', to_char(
        v_observed_at AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
      ),
      'reason', 'session_lease_expired',
      'errorCode', 'lease_lost'
    );

    v_final_worker_status_id := v_worker."worker_status_id";
    IF v_worker."worker_status_id" =
        '019a930d-c6f6-766d-9c84-30af6ecc33b2'::uuid
      AND v_worker."lifecycle_operation_id" IS NULL
    THEN
      UPDATE public."worker" AS worker
      SET "worker_status_id" =
            '019a930d-c6f6-766d-9c84-3696c2cd5ed8'::uuid,
          "updated_at" = v_observed_at
      WHERE worker."worker_id" = v_worker."worker_id"
        AND worker."worker_status_id" =
          '019a930d-c6f6-766d-9c84-30af6ecc33b2'::uuid
        AND worker."lifecycle_operation_id" IS NULL;
      IF FOUND THEN
        v_final_worker_status_id :=
          '019a930d-c6f6-766d-9c84-3696c2cd5ed8'::uuid;
      END IF;
    END IF;

    v_outbox_event_type := CASE
      WHEN v_final_worker_status_id =
        '019a930d-c6f6-766d-9c84-30af6ecc33b2'::uuid
        THEN 'telemetry'
      ELSE 'status'
    END;

    v_payload := jsonb_build_object(
      'event_type', v_outbox_event_type,
      'status', 'disconnected',
      'code', 408,
      'provider_state', 'lease_lost',
      'degraded_reason', 'session_lease_expired',
      'session_ready', false,
      'can_send', false,
      'can_receive_runtime', false,
      'authenticated',
        v_runtime."native_connection_status" -> 'authenticated',
      'connection_status', v_public_status,
      'connection_status_source_id',
        v_runtime."native_connection_status_source_id"::text,
      'connection_online_acknowledged', false
    );
    IF v_outbox_event_type = 'status' THEN
      v_payload := jsonb_set(
        v_payload,
        '{worker_status_id}',
        to_jsonb(v_final_worker_status_id::text),
        true
      );
    END IF;

    INSERT INTO public."worker_runtime_event_outbox" (
      "event_id", "worker_id", "account_id", "provider", "container_id",
      "runtime_generation", "writer_epoch", "connection_sequence",
      "capability_hash", "event_type", "payload", "state",
      "available_at", "created_at"
    ) VALUES (
      gen_random_uuid(), v_runtime."worker_id", v_worker."account_id",
      v_runtime."source_provider", v_runtime."container_id",
      v_runtime."runtime_generation", v_runtime."session_writer_epoch",
      v_runtime."connection_sequence", v_runtime."runtime_capability_hash",
      v_outbox_event_type, v_payload, 'pending', v_observed_at, v_observed_at
    )
    RETURNING "outbox_id" INTO v_outbox_id;

    UPDATE public."worker_runtime" AS runtime
    SET "native_connection_public_status" = v_public_status,
        "native_connection_status_outbox_id" = v_outbox_id,
        "native_connection_status_lease_owner_id" = NULL,
        "native_connection_status_fencing_token" = NULL,
        "native_connection_online_acknowledged" = false,
        "updated_at" = v_observed_at
    WHERE runtime."worker_id" = v_runtime."worker_id"
      AND runtime."native_connection_online_acknowledged"
      AND runtime."native_connection_status_outbox_id" =
        v_runtime."native_connection_status_outbox_id"
      AND runtime."native_connection_status_lease_owner_id" IS NOT DISTINCT
        FROM v_runtime."native_connection_status_lease_owner_id"
      AND runtime."native_connection_status_fencing_token" IS NOT DISTINCT
        FROM v_runtime."native_connection_status_fencing_token";
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated <> 1 THEN
      RAISE EXCEPTION 'online acknowledgement reconciliation CAS failed'
        USING ERRCODE = '40001';
    END IF;

    UPDATE public."worker_runtime_event_outbox" AS outbox
    SET "payload" = jsonb_set(
      outbox."payload",
      '{connection_status_order}',
      to_jsonb(v_outbox_id::text),
      true
    )
    WHERE outbox."outbox_id" = v_outbox_id;

    v_reconciled := v_reconciled + 1;
  END LOOP;

  RETURN v_reconciled;
END;
$function$;

REVOKE ALL ON FUNCTION public.reconcile_expired_whatsapp_online_acks(
  integer, integer
) FROM PUBLIC;
-- Atlas and service_api intentionally use DB_USER. Grant only that effective
-- control-plane role; whatsapp_session_runtime must never reconcile peers.
GRANT EXECUTE ON FUNCTION public.reconcile_expired_whatsapp_online_acks(
  integer, integer
) TO CURRENT_USER;

REVOKE ALL ON FUNCTION public.apply_worker_runtime_status_fenced_internal(
  uuid, uuid, text, integer, uuid, text, text, jsonb, uuid
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_worker_runtime_status_fenced_internal(
  uuid, uuid, text, integer, uuid, text, text, jsonb, uuid
) FROM whatsapp_session_runtime;

-- The partial native-status index introduced by 20260804120000 is useful for
-- the one-time lineage backfill above. Admission and reads are materialized in
-- worker_runtime afterwards, so retaining it would only add write/WAL cost to
-- every future native status event.
DROP INDEX public."worker_runtime_event_outbox_native_status_idx";
