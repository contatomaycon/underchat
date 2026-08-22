-- A replacement runtime can report a strongly fenced ONLINE state before the
-- manager records its recreate bootstrap marker. In that race the runtime
-- status transaction has already moved worker.container_id to the target, so
-- the original marker function's old-container != target check fails. Admit
-- that same-target state only when the exact runtime owns authoritative ONLINE
-- proof; the ordinary RECREATING path remains a distinct-container check.

ALTER TABLE public.worker_runtime
  ADD COLUMN recreate_retired_operation_id uuid,
  ADD COLUMN recreate_retired_runtime_generation integer,
  ADD COLUMN recreate_retired_container_id character varying(100),
  ADD COLUMN recreate_retired_at timestamp with time zone,
  ADD CONSTRAINT worker_runtime_recreate_retired_marker_check CHECK (
    (
      recreate_retired_operation_id IS NULL
      AND recreate_retired_runtime_generation IS NULL
      AND recreate_retired_container_id IS NULL
      AND recreate_retired_at IS NULL
    ) OR (
      recreate_retired_operation_id IS NOT NULL
      AND recreate_retired_runtime_generation IS NOT NULL
      AND recreate_retired_runtime_generation > 0
      AND recreate_retired_runtime_generation = runtime_generation
      AND recreate_retired_container_id IS NOT NULL
      AND lower(trim(recreate_retired_container_id)) ~ '^[0-9a-f]{12,64}$'
      AND container_id IS NOT NULL
      AND lower(trim(recreate_retired_container_id)) = lower(trim(container_id))
      AND recreate_retired_at IS NOT NULL
      AND runtime_capability_hash IS NULL
      AND session_writer_epoch IS NULL
      AND connection_epoch IS NULL
      AND connection_sequence = 0
      AND source_provider IS NULL
      AND connection_activated_at IS NULL
      AND recreate_bootstrap_operation_id IS NULL
      AND recreate_bootstrap_runtime_generation IS NULL
      AND recreate_bootstrap_container_id IS NULL
      AND recreate_bootstrap_started_at IS NULL
      AND native_connection_status IS NULL
      AND native_connection_public_status IS NULL
      AND native_connection_status_source_id IS NULL
      AND native_connection_status_sequence IS NULL
      AND native_connection_status_outbox_id IS NULL
      AND native_connection_status_lease_owner_id IS NULL
      AND native_connection_status_fencing_token IS NULL
      AND native_connection_status_changed_at_high_watermark IS NULL
      AND cardinality(native_connection_status_retired_source_ids) = 0
      AND native_connection_online_acknowledged IS FALSE
    )
  ) NOT VALID;

ALTER TABLE public.worker_runtime
  VALIDATE CONSTRAINT worker_runtime_recreate_retired_marker_check;

CREATE OR REPLACE FUNCTION public.reset_worker_runtime_recreate_retirement_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NEW.runtime_generation > OLD.runtime_generation THEN
    NEW.recreate_retired_operation_id := NULL;
    NEW.recreate_retired_runtime_generation := NULL;
    NEW.recreate_retired_container_id := NULL;
    NEW.recreate_retired_at := NULL;
  ELSIF OLD.recreate_retired_operation_id IS NOT NULL
    AND (
      OLD.runtime_generation IS DISTINCT FROM NEW.runtime_generation
      OR lower(trim(OLD.container_id)) IS DISTINCT FROM
         lower(trim(NEW.container_id))
      OR OLD.recreate_retired_operation_id IS DISTINCT FROM
         NEW.recreate_retired_operation_id
      OR OLD.recreate_retired_runtime_generation IS DISTINCT FROM
         NEW.recreate_retired_runtime_generation
      OR lower(trim(OLD.recreate_retired_container_id)) IS DISTINCT FROM
         lower(trim(NEW.recreate_retired_container_id))
      OR OLD.recreate_retired_at IS DISTINCT FROM NEW.recreate_retired_at
    )
  THEN
    RAISE EXCEPTION
      'retired runtime tombstone cannot change without generation advance'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.reset_worker_runtime_recreate_retirement_v1()
  FROM PUBLIC;

CREATE TRIGGER worker_runtime_recreate_retirement_reset_trg
BEFORE UPDATE ON public.worker_runtime
FOR EACH ROW
EXECUTE FUNCTION public.reset_worker_runtime_recreate_retirement_v1();

CREATE OR REPLACE FUNCTION public.mark_worker_recreate_bootstrap_started(
  p_worker_id uuid,
  p_account_id uuid,
  p_server_id uuid,
  p_lifecycle_operation_id uuid,
  p_runtime_generation integer,
  p_container_id text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '10s'
AS $function$
DECLARE
  v_worker public.worker%ROWTYPE;
  v_runtime public.worker_runtime%ROWTYPE;
  v_container_id text;
  v_same_target boolean;
BEGIN
  v_container_id := lower(trim(p_container_id));
  IF p_worker_id IS NULL
    OR p_account_id IS NULL
    OR p_server_id IS NULL
    OR p_lifecycle_operation_id IS NULL
    OR p_runtime_generation IS NULL
    OR p_runtime_generation <= 0
    OR v_container_id IS NULL
    OR v_container_id !~ '^[0-9a-f]{12,64}$'
  THEN
    RETURN false;
  END IF;

  -- Global lifecycle lock order remains worker -> runtime -> lease.
  SELECT owner.*
  INTO v_worker
  FROM public.worker AS owner
  WHERE owner.worker_id = p_worker_id
  FOR UPDATE;
  IF NOT FOUND
    OR v_worker.account_id IS DISTINCT FROM p_account_id
    OR v_worker.server_id IS DISTINCT FROM p_server_id
    OR v_worker.worker_status_id NOT IN (
      '019a930d-c6f6-766d-9c84-46093814d8e0'::uuid,
      '019a930d-c6f6-766d-9c84-30af6ecc33b2'::uuid
    )
    OR v_worker.lifecycle_operation_id IS DISTINCT FROM
      p_lifecycle_operation_id
    OR v_worker.deleted_at IS NOT NULL
    OR v_worker.container_id IS NULL
    OR lower(trim(v_worker.container_id)) !~ '^[0-9a-f]{12,64}$'
  THEN
    RETURN false;
  END IF;

  SELECT runtime.*
  INTO v_runtime
  FROM public.worker_runtime AS runtime
  WHERE runtime.worker_id = p_worker_id
    AND runtime.runtime_generation = p_runtime_generation
    AND runtime.container_id IS NOT NULL
    AND lower(trim(runtime.container_id)) = v_container_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- A retired exact physical runtime is an irreversible cleanup target. It
  -- may be redelivered for removal, but must never regain a bootstrap marker.
  IF v_runtime.recreate_retired_operation_id IS NOT NULL THEN
    RETURN false;
  END IF;

  -- Once this exact physical start is durable, redelivery must remain
  -- idempotent even if the provider acknowledgement or its PostgreSQL lease
  -- degrades before the manager commits the lifecycle tombstone. The worker
  -- operation and runtime generation/container locks above still prove that
  -- this replay belongs to the same in-flight recreate.
  IF v_runtime.recreate_bootstrap_operation_id IS NOT DISTINCT FROM
       p_lifecycle_operation_id
    AND v_runtime.recreate_bootstrap_runtime_generation IS NOT DISTINCT FROM
       p_runtime_generation
    AND lower(trim(v_runtime.recreate_bootstrap_container_id))
          IS NOT DISTINCT FROM v_container_id
    AND v_runtime.recreate_bootstrap_started_at IS NOT NULL
  THEN
    RETURN true;
  END IF;

  v_same_target :=
    lower(trim(v_worker.container_id)) = v_container_id
    OR lower(trim(v_worker.container_id)) LIKE v_container_id || '%'
    OR v_container_id LIKE lower(trim(v_worker.container_id)) || '%';

  IF NOT v_same_target AND v_worker.worker_status_id IS DISTINCT FROM
       '019a930d-c6f6-766d-9c84-46093814d8e0'::uuid
  THEN
    RETURN false;
  ELSIF v_same_target THEN
    -- The target pointer may move only through the runtime's fenced ONLINE
    -- admission. Require all durable self-origin evidence before recovering
    -- the marker that lost the race with that transaction.
    IF v_worker.worker_status_id IS DISTINCT FROM
         '019a930d-c6f6-766d-9c84-30af6ecc33b2'::uuid
      OR v_runtime.session_storage IS DISTINCT FROM v_worker.session_storage
      OR v_runtime.source_provider IS DISTINCT FROM (
        CASE v_worker.worker_type_id
          WHEN '019a930d-c6f6-766d-9c84-53307d4159a1'::uuid THEN 'baileys'
          WHEN '019a930d-c6f6-766d-9c84-62b9c3e7d1f0'::uuid THEN 'wwebjs'
          WHEN 'e80ad183-2b46-4628-9105-a036f2d28720'::uuid THEN 'whatsmeow'
          ELSE NULL
        END
      )
      OR v_runtime.connection_activated_at IS NULL
      OR v_runtime.runtime_capability_hash IS NULL
      OR v_runtime.runtime_capability_hash !~ '^[0-9a-f]{64}$'
      OR v_runtime.session_writer_epoch IS NULL
      OR v_runtime.connection_epoch IS NULL
      OR v_runtime.connection_sequence IS NULL
      OR v_runtime.connection_sequence NOT BETWEEN 1 AND 9007199254740991
      OR v_runtime.native_connection_online_acknowledged IS NOT TRUE
      OR v_runtime.native_connection_status_source_id IS NULL
      OR v_runtime.native_connection_status_sequence IS NULL
      OR v_runtime.native_connection_status_sequence NOT BETWEEN
           1 AND 9007199254740991
      OR v_runtime.native_connection_status_outbox_id IS NULL
      OR v_runtime.native_connection_status_outbox_id <= 0
      OR v_runtime.native_connection_status ->> 'provider'
           IS DISTINCT FROM v_runtime.source_provider
      OR v_runtime.native_connection_status ->> 'status'
           IS DISTINCT FROM 'online'
      OR v_runtime.native_connection_status ->> 'sequence'
           IS DISTINCT FROM v_runtime.native_connection_status_sequence::text
      OR v_runtime.native_connection_status -> 'connected'
           IS DISTINCT FROM 'true'::jsonb
      OR v_runtime.native_connection_status -> 'authenticated'
           IS DISTINCT FROM 'true'::jsonb
      OR v_runtime.native_connection_status -> 'sessionValid'
           IS DISTINCT FROM 'true'::jsonb
      OR v_runtime.native_connection_status -> 'qrAvailable'
           IS DISTINCT FROM 'false'::jsonb
      OR v_runtime.native_connection_public_status ->> 'provider'
           IS DISTINCT FROM v_runtime.source_provider
      OR v_runtime.native_connection_public_status ->> 'status'
           IS DISTINCT FROM 'online'
      OR v_runtime.native_connection_public_status ->> 'sequence'
           IS DISTINCT FROM v_runtime.native_connection_status_sequence::text
      OR v_runtime.native_connection_public_status -> 'connected'
           IS DISTINCT FROM 'true'::jsonb
      OR v_runtime.native_connection_public_status -> 'authenticated'
           IS DISTINCT FROM 'true'::jsonb
      OR v_runtime.native_connection_public_status -> 'sessionValid'
           IS DISTINCT FROM 'true'::jsonb
      OR v_runtime.native_connection_public_status -> 'qrAvailable'
           IS DISTINCT FROM 'false'::jsonb
    THEN
      RETURN false;
    END IF;

    IF v_runtime.session_storage = 'postgres' THEN
      PERFORM 1
      FROM public.whatsapp_session_lease AS lease
      WHERE lease.session_id = p_worker_id
        AND lease.provider = v_runtime.source_provider
        AND lease.generation = v_runtime.runtime_generation
        AND lease.epoch = v_runtime.session_writer_epoch
        AND lease.owner_id = v_runtime.native_connection_status_lease_owner_id
        AND lease.fencing_token =
          v_runtime.native_connection_status_fencing_token
        AND lease.expires_at > clock_timestamp() + interval '5 seconds'
      FOR SHARE;
      IF NOT FOUND THEN
        RETURN false;
      END IF;
    ELSIF v_runtime.session_storage = 'legacy_volume' THEN
      IF v_runtime.native_connection_status_lease_owner_id IS NOT NULL
        OR v_runtime.native_connection_status_fencing_token IS NOT NULL
      THEN
        RETURN false;
      END IF;
    ELSE
      RETURN false;
    END IF;
  END IF;

  UPDATE public.worker_runtime AS runtime
  SET recreate_bootstrap_operation_id = p_lifecycle_operation_id,
      recreate_bootstrap_runtime_generation = p_runtime_generation,
      recreate_bootstrap_container_id = runtime.container_id,
      recreate_bootstrap_started_at = CASE
        WHEN runtime.recreate_bootstrap_operation_id IS NOT DISTINCT FROM
               p_lifecycle_operation_id
          AND runtime.recreate_bootstrap_runtime_generation IS NOT DISTINCT FROM
               p_runtime_generation
          AND lower(trim(runtime.recreate_bootstrap_container_id))
                IS NOT DISTINCT FROM v_container_id
          AND runtime.recreate_bootstrap_started_at IS NOT NULL
        THEN runtime.recreate_bootstrap_started_at
        ELSE clock_timestamp()
      END,
      updated_at = clock_timestamp()
  WHERE runtime.worker_id = p_worker_id
    AND runtime.runtime_generation = p_runtime_generation
    AND runtime.container_id IS NOT NULL
    AND lower(trim(runtime.container_id)) = v_container_id;

  RETURN FOUND;
END;
$function$;

REVOKE ALL ON FUNCTION public.mark_worker_recreate_bootstrap_started(
  uuid, uuid, uuid, uuid, integer, text
) FROM PUBLIC;
