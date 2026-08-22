-- A user-requested disconnect keeps the live runtime and its lease so the
-- same fenced worker can serve a later, explicit QR request. Remove only the
-- operational/authentication tree and leave the session header as the empty
-- canonical anchor. Handoff resolutions are worker-owned audit/idempotency
-- records and are intentionally retained.
ALTER TABLE public.worker
  ADD COLUMN external_connection_revision bigint NOT NULL DEFAULT 1,
  ADD CONSTRAINT worker_external_connection_revision_check CHECK (
    external_connection_revision > 0
  );

ALTER TABLE public.worker_runtime
  ADD COLUMN disconnected_connection_epoch varchar(100),
  ADD COLUMN connection_disconnected_at timestamptz,
  ADD CONSTRAINT worker_runtime_disconnect_barrier_check CHECK (
    (
      disconnected_connection_epoch IS NULL
      AND connection_disconnected_at IS NULL
    ) OR (
      connection_disconnected_at IS NOT NULL
      AND (
        disconnected_connection_epoch IS NULL
        OR length(trim(disconnected_connection_epoch)) BETWEEN 1 AND 100
      )
    )
  );

CREATE OR REPLACE FUNCTION public.clear_whatsapp_session(
  p_session_id uuid,
  p_owner_id uuid,
  p_fencing_token bigint,
  p_generation integer,
  p_epoch uuid,
  p_capability text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_capability_hash text;
BEGIN
  IF p_session_id IS NULL OR p_owner_id IS NULL OR p_epoch IS NULL
    OR p_fencing_token <= 0 OR p_generation <= 0
    OR p_capability IS NULL OR length(p_capability) < 32
    OR length(p_capability) > 512
  THEN
    RAISE EXCEPTION 'invalid whatsapp session clear arguments'
      USING ERRCODE = '22023';
  END IF;

  v_capability_hash := encode(public.digest(p_capability, 'sha256'), 'hex');
  PERFORM set_config('app.whatsapp_session_id', p_session_id::text, true);

  PERFORM 1
  FROM public.whatsapp_session_lease AS lease
  JOIN public.whatsapp_session AS session
    ON session.session_id = lease.session_id
  WHERE lease.session_id = p_session_id
    AND lease.owner_id = p_owner_id
    AND lease.fencing_token = p_fencing_token
    AND lease.generation = p_generation
    AND lease.epoch = p_epoch
    AND lease.expires_at > clock_timestamp()
    AND lease.provider = session.provider
    AND session.generation = p_generation
    AND session.epoch = p_epoch
    AND session.capability_hash = v_capability_hash
    AND session.state <> 'handoff'
  FOR SHARE OF lease
  FOR UPDATE OF session;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stale or unauthorized whatsapp session clear'
      USING ERRCODE = '55000';
  END IF;

  -- The disconnect barrier is installed before the provider cleanup so no
  -- later writer can recreate credentials between logout and finalization.
  -- Only this fenced SECURITY DEFINER operation may perform the exact
  -- ready/preparing -> empty header transition while that barrier is active.
  PERFORM set_config(
    'app.whatsapp_disconnect_clear_session_id',
    p_session_id::text,
    true
  );

  PERFORM 1
  FROM public.whatsapp_session_revision
  WHERE session_id = p_session_id
  FOR UPDATE;

  UPDATE public.whatsapp_session
  SET state = 'empty',
      active_revision_id = NULL,
      previous_revision_id = NULL,
      active_device_fingerprint = NULL,
      active_device_fingerprint_version = NULL,
      last_persisted_at = NULL,
      last_error_at = NULL,
      updated_at = clock_timestamp()
  WHERE session_id = p_session_id
    AND generation = p_generation
    AND epoch = p_epoch;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'whatsapp session changed during clear'
      USING ERRCODE = '40001';
  END IF;

  DELETE FROM public.whatsapp_companion_reservation
  WHERE session_id = p_session_id;
  DELETE FROM public.whatsapp_session_handoff
  WHERE session_id = p_session_id;

  -- Chunks restrict blob deletion. Delete them explicitly before the
  -- revision cascade and blob cleanup so partially staged WWebJS artifacts
  -- cannot make an otherwise authorized logout fail or survive it.
  DELETE FROM public.whatsapp_artifact_chunk
  WHERE session_id = p_session_id;
  DELETE FROM public.whatsapp_session_revision
  WHERE session_id = p_session_id;
  DELETE FROM public.whatsapp_artifact_blob
  WHERE session_id = p_session_id;

  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.clear_whatsapp_session(
  uuid, uuid, bigint, integer, uuid, text
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.clear_whatsapp_session(
  uuid, uuid, bigint, integer, uuid, text
) TO whatsapp_session_runtime;

-- The native-status implementation historically treated a user logout like
-- runtime retirement and nulled worker.container_id. An in-place disconnect
-- keeps that runtime alive, so wrap the existing fully-fenced implementation
-- and restore the exact immutable runtime pointer in the same transaction.
ALTER FUNCTION public.apply_worker_runtime_status(
  uuid, uuid, text, integer, uuid, text, text, jsonb, uuid
) RENAME TO apply_worker_runtime_status_disconnect_base;

REVOKE ALL ON FUNCTION public.apply_worker_runtime_status_disconnect_base(
  uuid, uuid, text, integer, uuid, text, text, jsonb, uuid
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_worker_runtime_status_disconnect_base(
  uuid, uuid, text, integer, uuid, text, text, jsonb, uuid
) FROM whatsapp_session_runtime;

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
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_outcome text;
  v_event_id uuid;
BEGIN
  -- Serialize with the manager finalizer using the same worker -> runtime
  -- lock order. Without these locks an event could observe no tombstone,
  -- wait behind the finalizer inside the previous implementation and then
  -- apply ONLINE after the disconnect committed.
  PERFORM 1
  FROM public.worker AS owner
  WHERE owner.worker_id = p_worker_id
    AND owner.account_id = p_account_id
  FOR UPDATE;
  IF NOT FOUND THEN
    outcome := 'stale';
    event_id := p_event_id;
    RETURN NEXT;
    RETURN;
  END IF;

  PERFORM 1
  FROM public.worker_runtime AS runtime
  WHERE runtime.worker_id = p_worker_id
    AND runtime.runtime_generation = p_generation
  FOR UPDATE;
  IF NOT FOUND THEN
    outcome := 'stale';
    event_id := p_event_id;
    RETURN NEXT;
    RETURN;
  END IF;

  -- A terminal event from the removed connection can still be delivered
  -- after Redis/UI state was cleared. The exact connection epoch is a durable
  -- tombstone; only activation of a different epoch can make ONLINE current.
  IF EXISTS (
      SELECT 1
      FROM public.worker_runtime AS runtime
      WHERE runtime.worker_id = p_worker_id
        AND runtime.runtime_generation = p_generation
        AND runtime.connection_disconnected_at IS NOT NULL
        AND runtime.connection_epoch IS NOT DISTINCT FROM
          runtime.disconnected_connection_epoch
    )
  THEN
    outcome := CASE
      WHEN p_status ->> 'worker_status_id' =
          '019a930d-c6f6-766d-9c84-3904383fe742'
        AND lower(COALESCE(p_status ->> 'disconnected_user', 'false')) = 'true'
        AND EXISTS (
          SELECT 1
          FROM public.worker AS owner
          JOIN public.worker_runtime AS runtime
            ON runtime.worker_id = owner.worker_id
          WHERE owner.worker_id = p_worker_id
            AND owner.account_id = p_account_id
            AND owner.deleted_at IS NULL
            AND owner.lifecycle_operation_id IS NULL
            AND owner.worker_status_id =
              '019a930d-c6f6-766d-9c84-3904383fe742'::uuid
            AND runtime.runtime_generation = p_generation
            AND runtime.source_provider = lower(trim(p_provider))
            AND runtime.session_writer_epoch = p_writer_epoch
            AND runtime.runtime_capability_hash =
              encode(public.digest(p_capability, 'sha256'), 'hex')
            AND (
              runtime.container_id = trim(p_container_id)
              OR runtime.container_id LIKE trim(p_container_id) || '%'
            )
        )
      THEN 'duplicate'
      ELSE 'stale'
    END;
    event_id := p_event_id;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT applied.outcome, applied.event_id
  INTO v_outcome, v_event_id
  FROM public.apply_worker_runtime_status_disconnect_base(
    p_worker_id,
    p_account_id,
    p_provider,
    p_generation,
    p_writer_epoch,
    p_capability,
    p_container_id,
    p_status,
    p_event_id
  ) AS applied;

  IF v_outcome = 'applied'
    AND COALESCE(NULLIF(trim(p_status ->> 'event_type'), ''), 'status') = 'status'
    AND lower(COALESCE(p_status ->> 'disconnected_user', 'false')) = 'true'
    AND p_status ->> 'worker_status_id' =
      '019a930d-c6f6-766d-9c84-3904383fe742'
  THEN
    UPDATE public.worker AS owner
    SET container_id = runtime.container_id,
        updated_at = clock_timestamp()
    FROM public.worker_runtime AS runtime
    WHERE owner.worker_id = p_worker_id
      AND owner.account_id = p_account_id
      AND owner.deleted_at IS NULL
      AND owner.lifecycle_operation_id IS NULL
      AND owner.worker_status_id =
        '019a930d-c6f6-766d-9c84-3904383fe742'::uuid
      AND runtime.worker_id = owner.worker_id
      AND runtime.runtime_generation = p_generation
      AND runtime.container_id IS NOT NULL
      AND (
        runtime.container_id = trim(p_container_id)
        OR runtime.container_id LIKE trim(p_container_id) || '%'
      );
    IF NOT FOUND THEN
      RAISE EXCEPTION 'worker disconnect runtime pointer changed'
        USING ERRCODE = '40001';
    END IF;
  END IF;

  outcome := COALESCE(v_outcome, 'invalid');
  event_id := COALESCE(v_event_id, p_event_id);
  RETURN NEXT;
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_worker_runtime_status(
  uuid, uuid, text, integer, uuid, text, text, jsonb, uuid
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_worker_runtime_status(
  uuid, uuid, text, integer, uuid, text, text, jsonb, uuid
) TO whatsapp_session_runtime;

-- Activation is the only operation allowed to release the durable disconnect
-- barrier. Replaying the disconnected epoch is rejected; a genuinely new
-- epoch is fully activated by the existing implementation and only then
-- clears the tombstone in the same transaction.
ALTER FUNCTION public.activate_whatsapp_runtime_fence(
  uuid, uuid, text, integer, uuid, text, text, uuid
) RENAME TO activate_whatsapp_runtime_fence_disconnect_base;

REVOKE ALL ON FUNCTION public.activate_whatsapp_runtime_fence_disconnect_base(
  uuid, uuid, text, integer, uuid, text, text, uuid
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.activate_whatsapp_runtime_fence_disconnect_base(
  uuid, uuid, text, integer, uuid, text, text, uuid
) FROM whatsapp_session_runtime;

CREATE OR REPLACE FUNCTION public.activate_whatsapp_runtime_fence(
  p_worker_id uuid,
  p_account_id uuid,
  p_provider text,
  p_generation integer,
  p_writer_epoch uuid,
  p_capability text,
  p_container_id text,
  p_connection_epoch uuid
)
RETURNS TABLE (
  activated boolean,
  already_active boolean,
  connection_sequence bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_result record;
  v_disconnected_connection_epoch varchar(100);
  v_connection_disconnected_at timestamptz;
  v_disconnect_barrier_active boolean := false;
BEGIN
  activated := false;
  already_active := false;
  connection_sequence := NULL;

  -- Preserve the global worker -> runtime lock order used by the base
  -- implementation and the manager-side disconnect finalizer.
  PERFORM 1
  FROM public.worker AS owner
  WHERE owner.worker_id = p_worker_id
    AND owner.account_id = p_account_id
  FOR SHARE;
  IF NOT FOUND THEN
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT runtime.disconnected_connection_epoch,
         runtime.connection_disconnected_at,
         (
           runtime.connection_disconnected_at IS NOT NULL
           AND runtime.connection_epoch IS NOT DISTINCT FROM
             runtime.disconnected_connection_epoch
         )
  INTO v_disconnected_connection_epoch,
       v_connection_disconnected_at,
       v_disconnect_barrier_active
  FROM public.worker_runtime AS runtime
  WHERE runtime.worker_id = p_worker_id
    AND runtime.runtime_generation = p_generation
  FOR UPDATE;
  IF FOUND AND v_disconnect_barrier_active THEN
    IF v_disconnected_connection_epoch = p_connection_epoch::text THEN
      RETURN NEXT;
      RETURN;
    END IF;

    -- Session-header writes are guarded while the tombstone is active. Clear
    -- it transaction-locally before invoking the previous activation body.
    -- Other transactions still observe the committed tombstone until this
    -- transaction commits; failures restore it below or roll back atomically.
    UPDATE public.worker_runtime AS runtime
    SET disconnected_connection_epoch = NULL,
        connection_disconnected_at = NULL,
        updated_at = clock_timestamp()
    WHERE runtime.worker_id = p_worker_id
      AND runtime.runtime_generation = p_generation
      AND runtime.disconnected_connection_epoch IS NOT DISTINCT FROM
        v_disconnected_connection_epoch
      AND runtime.connection_disconnected_at IS NOT DISTINCT FROM
        v_connection_disconnected_at;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'whatsapp disconnect barrier changed during activation'
        USING ERRCODE = '40001';
    END IF;
  END IF;

  SELECT result.activated,
         result.already_active,
         result.connection_sequence
  INTO v_result
  FROM public.activate_whatsapp_runtime_fence_disconnect_base(
    p_worker_id,
    p_account_id,
    p_provider,
    p_generation,
    p_writer_epoch,
    p_capability,
    p_container_id,
    p_connection_epoch
  ) AS result;

  activated := COALESCE(v_result.activated, false);
  already_active := COALESCE(v_result.already_active, false);
  connection_sequence := v_result.connection_sequence;

  IF activated THEN
    UPDATE public.worker_runtime AS runtime
    SET disconnected_connection_epoch = NULL,
        connection_disconnected_at = NULL,
        updated_at = clock_timestamp()
    WHERE runtime.worker_id = p_worker_id
      AND runtime.runtime_generation = p_generation
      AND runtime.connection_epoch = p_connection_epoch::text
      AND (
        runtime.container_id = trim(p_container_id)
        OR runtime.container_id LIKE trim(p_container_id) || '%'
      );
    IF NOT FOUND THEN
      RAISE EXCEPTION 'whatsapp disconnect barrier changed during activation'
        USING ERRCODE = '40001';
    END IF;
  ELSIF v_disconnect_barrier_active THEN
    UPDATE public.worker_runtime AS runtime
    SET disconnected_connection_epoch = v_disconnected_connection_epoch,
        connection_disconnected_at = v_connection_disconnected_at,
        updated_at = clock_timestamp()
    WHERE runtime.worker_id = p_worker_id
      AND runtime.runtime_generation = p_generation
      AND runtime.disconnected_connection_epoch IS NULL
      AND runtime.connection_disconnected_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'whatsapp disconnect barrier changed during activation'
        USING ERRCODE = '40001';
    END IF;
  END IF;

  RETURN NEXT;
END;
$function$;

REVOKE ALL ON FUNCTION public.activate_whatsapp_runtime_fence(
  uuid, uuid, text, integer, uuid, text, text, uuid
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.activate_whatsapp_runtime_fence(
  uuid, uuid, text, integer, uuid, text, text, uuid
) TO whatsapp_session_runtime;

-- SECURITY DEFINER session writers also pass through triggers. Keep the
-- empty canonical header, but fail closed if a delayed writer tries to rebuild
-- revisions/reservations/handoffs or mark the header active after disconnect.
CREATE OR REPLACE FUNCTION public.guard_disconnected_whatsapp_session_writer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_session_id uuid;
BEGIN
  v_session_id := NEW.session_id;

  IF EXISTS (
    SELECT 1
    FROM public.worker_runtime AS runtime
    WHERE runtime.worker_id = v_session_id
      AND runtime.connection_disconnected_at IS NOT NULL
      AND runtime.connection_epoch IS NOT DISTINCT FROM
        runtime.disconnected_connection_epoch
  ) THEN
    -- Keep table-specific record access in its own branch. PL/pgSQL prepares
    -- record expressions lazily, but an AND chain that mentions header-only
    -- fields is still invalid when this trigger runs for a child table.
    IF TG_TABLE_NAME = 'whatsapp_session' AND TG_OP = 'UPDATE' THEN
      IF nullif(current_setting(
          'app.whatsapp_disconnect_clear_session_id', true
        ), '')::uuid IS NOT DISTINCT FROM v_session_id
        AND NEW.provider IS NOT DISTINCT FROM OLD.provider
        AND NEW.generation IS NOT DISTINCT FROM OLD.generation
        AND NEW.epoch IS NOT DISTINCT FROM OLD.epoch
        AND NEW.capability_hash IS NOT DISTINCT FROM OLD.capability_hash
        AND NEW.state = 'empty'
        AND NEW.active_revision_id IS NULL
        AND NEW.previous_revision_id IS NULL
        AND NEW.active_device_fingerprint IS NULL
        AND NEW.active_device_fingerprint_version IS NULL
        AND NEW.last_persisted_at IS NULL
        AND NEW.last_error_at IS NULL
      THEN
        RETURN NEW;
      END IF;
    END IF;

    RAISE EXCEPTION 'whatsapp connection epoch was disconnected'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_disconnected_whatsapp_session_writer()
FROM PUBLIC;

CREATE TRIGGER whatsapp_session_revision_disconnect_guard
BEFORE INSERT ON public.whatsapp_session_revision
FOR EACH ROW
EXECUTE FUNCTION public.guard_disconnected_whatsapp_session_writer();

CREATE TRIGGER whatsapp_companion_reservation_disconnect_guard
BEFORE INSERT ON public.whatsapp_companion_reservation
FOR EACH ROW
EXECUTE FUNCTION public.guard_disconnected_whatsapp_session_writer();

CREATE TRIGGER whatsapp_session_handoff_disconnect_guard
BEFORE INSERT ON public.whatsapp_session_handoff
FOR EACH ROW
EXECUTE FUNCTION public.guard_disconnected_whatsapp_session_writer();

CREATE TRIGGER whatsapp_artifact_blob_disconnect_guard
BEFORE INSERT ON public.whatsapp_artifact_blob
FOR EACH ROW
EXECUTE FUNCTION public.guard_disconnected_whatsapp_session_writer();

CREATE TRIGGER whatsapp_session_header_disconnect_guard
BEFORE INSERT OR UPDATE ON public.whatsapp_session
FOR EACH ROW
EXECUTE FUNCTION public.guard_disconnected_whatsapp_session_writer();
