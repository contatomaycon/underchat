-- A provider handoff deliberately keeps the source runtime authoritative while
-- the worker lifecycle is `recreating` and the handoff is still being requested
-- or drained.  A cold restart of that exact runtime must be able to reacquire
-- its database fence so it can finish the source checkpoint.  Keep the normal
-- recreate protection fail-closed and admit only the source runtime bound to
-- the same PostgreSQL session, active source revision and lifecycle operation.

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
  v_expected_worker_type uuid;
  v_capability_hash text;
  v_worker_storage character varying(20);
  v_worker_status_id uuid;
  v_worker_container_id character varying(100);
  v_lifecycle_operation_id uuid;
  v_runtime public.worker_runtime%ROWTYPE;
  v_header_provider character varying(20);
  v_header_generation integer;
  v_header_writer_epoch uuid;
  v_header_capability_hash character varying(64);
  v_header_state character varying(20);
  v_header_active_revision_id bigint;
  v_header_allows_provider boolean := true;
  v_source_handoff_restart_authorized boolean := false;
BEGIN
  activated := false;
  already_active := false;
  connection_sequence := NULL;

  IF p_worker_id IS NULL
    OR p_account_id IS NULL
    OR p_generation IS NULL
    OR p_generation <= 0
    OR p_writer_epoch IS NULL
    OR p_connection_epoch IS NULL
    OR p_capability IS NULL
    OR length(p_capability) < 32
    OR length(p_capability) > 512
    OR p_container_id IS NULL
    OR trim(p_container_id) !~ '^[0-9a-f]{12,64}$'
  THEN
    RETURN NEXT;
    RETURN;
  END IF;

  v_expected_worker_type := CASE lower(trim(p_provider))
    WHEN 'baileys' THEN '019a930d-c6f6-766d-9c84-53307d4159a1'::uuid
    WHEN 'wwebjs' THEN '019a930d-c6f6-766d-9c84-62b9c3e7d1f0'::uuid
    WHEN 'whatsmeow' THEN 'e80ad183-2b46-4628-9105-a036f2d28720'::uuid
    ELSE NULL
  END;
  IF v_expected_worker_type IS NULL THEN
    RETURN NEXT;
    RETURN;
  END IF;

  v_capability_hash := encode(public.digest(p_capability, 'sha256'), 'hex');
  PERFORM set_config('app.whatsapp_session_id', p_worker_id::text, true);

  -- Global lock order is worker, runtime, warm lineage (when present),
  -- session header, active source revision and handoff.
  SELECT w."session_storage", w."worker_status_id", w."container_id",
    w."lifecycle_operation_id"
  INTO v_worker_storage, v_worker_status_id, v_worker_container_id,
    v_lifecycle_operation_id
  FROM public."worker" AS w
  WHERE w."worker_id" = p_worker_id
    AND w."account_id" = p_account_id
    AND (
      w."worker_type_id" = v_expected_worker_type
      OR (
        w."session_storage" = 'postgres'
        AND EXISTS (
          SELECT 1
          FROM public."whatsapp_session_handoff" AS target_handoff
          WHERE target_handoff."session_id" = w."worker_id"
            AND target_handoff."lifecycle_operation_id" = w."lifecycle_operation_id"
            AND target_handoff."target_provider" = lower(trim(p_provider))
            AND w."worker_type_id" = CASE target_handoff."source_provider"
              WHEN 'baileys' THEN '019a930d-c6f6-766d-9c84-53307d4159a1'::uuid
              WHEN 'wwebjs' THEN '019a930d-c6f6-766d-9c84-62b9c3e7d1f0'::uuid
              WHEN 'whatsmeow' THEN 'e80ad183-2b46-4628-9105-a036f2d28720'::uuid
            END
            AND target_handoff."state" IN (
              'transforming', 'hydrating', 'validating', 'promoting'
            )
        )
      )
    )
    AND w."deleted_at" IS NULL
    AND w."worker_status_id" NOT IN (
      '019a930d-c6f6-766d-9c84-437433031776'::uuid,
      '019a930d-c6f6-766d-9c84-4dc1777f8f69'::uuid,
      '019bcd18-ce66-77a2-9d7c-e48159c253da'::uuid
    )
  FOR SHARE;
  IF NOT FOUND THEN
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT runtime.*
  INTO v_runtime
  FROM public."worker_runtime" AS runtime
  WHERE runtime."worker_id" = p_worker_id
  FOR UPDATE;
  IF NOT FOUND
    OR v_runtime."container_id" IS NULL
    OR NOT (
      v_runtime."container_id" = trim(p_container_id)
      OR v_runtime."container_id" LIKE trim(p_container_id) || '%'
    )
    OR v_runtime."runtime_generation" <> p_generation
    OR v_runtime."runtime_capability_hash" IS NULL
    OR v_runtime."runtime_capability_hash" <> v_capability_hash
    OR v_runtime."session_storage" IS DISTINCT FROM v_worker_storage
    OR v_runtime."session_writer_epoch" IS DISTINCT FROM p_writer_epoch
    OR (
      v_runtime."source_provider" IS NOT NULL
      AND v_runtime."source_provider" <> lower(trim(p_provider))
    )
  THEN
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_worker_storage = 'postgres' AND v_runtime."warm_pool_id" IS NOT NULL THEN
    PERFORM 1
    FROM public."worker_warm_pool" AS pool
    WHERE pool."warm_pool_id" = v_runtime."warm_pool_id"
      AND pool."state" IN ('activating', 'assigned')
      AND pool."reserved_by_worker_id" = p_worker_id
      AND pool."worker_type_id" = v_expected_worker_type
      AND pool."session_storage" = 'postgres'
      AND pool."session_volume_name" IS NULL
      AND pool."runtime_generation" = v_runtime."runtime_generation"
      AND pool."runtime_capability_hash" = v_runtime."runtime_capability_hash"
      AND pool."session_writer_epoch" = v_runtime."session_writer_epoch"
      AND pool."container_id" = v_runtime."container_id"
    FOR SHARE;
    IF NOT FOUND THEN
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  IF v_worker_storage = 'postgres' THEN
    SELECT session."provider", session."generation",
      session."epoch", session."capability_hash", session."state",
      session."active_revision_id"
    INTO v_header_provider, v_header_generation, v_header_writer_epoch,
      v_header_capability_hash, v_header_state,
      v_header_active_revision_id
    FROM public."whatsapp_session" AS session
    WHERE session."session_id" = p_worker_id
    FOR UPDATE;

    IF FOUND THEN
      v_header_allows_provider :=
        (
          v_header_provider = lower(trim(p_provider))
          AND (
            v_header_state <> 'handoff'
            OR EXISTS (
              SELECT 1
              FROM public."whatsapp_session_handoff" AS source_handoff
              WHERE source_handoff."session_id" = p_worker_id
                AND source_handoff."source_provider" = lower(trim(p_provider))
                AND source_handoff."state" IN ('requested', 'draining')
            )
          )
        )
        OR (
          v_header_state = 'handoff'
          AND EXISTS (
            SELECT 1
            FROM public."whatsapp_session_handoff" AS target_handoff
            WHERE target_handoff."session_id" = p_worker_id
              AND target_handoff."target_provider" = lower(trim(p_provider))
              AND target_handoff."state" IN (
                'transforming', 'hydrating', 'validating', 'promoting'
              )
          )
        );
    END IF;

    IF FOUND AND (
      NOT v_header_allows_provider
      OR v_header_generation > p_generation
      OR (
        v_header_generation = p_generation
        AND v_header_writer_epoch IS NOT NULL
        AND v_header_writer_epoch <> p_writer_epoch
      )
      OR (
        v_header_generation = p_generation
        AND v_header_capability_hash IS NOT NULL
        AND v_header_capability_hash <> v_capability_hash
      )
    ) THEN
      RETURN NEXT;
      RETURN;
    END IF;

    IF FOUND
      AND v_worker_status_id = '019a930d-c6f6-766d-9c84-46093814d8e0'::uuid
      AND v_runtime."container_id" IS NOT DISTINCT FROM v_worker_container_id
      AND v_lifecycle_operation_id IS NOT NULL
      AND v_runtime."source_provider" = lower(trim(p_provider))
      AND v_header_state = 'handoff'
      AND v_header_provider = lower(trim(p_provider))
      AND v_header_active_revision_id IS NOT NULL
      AND v_header_generation = p_generation
      AND v_header_writer_epoch = p_writer_epoch
      AND v_header_capability_hash = v_capability_hash
    THEN
      SELECT true
      INTO v_source_handoff_restart_authorized
      FROM public."whatsapp_session_revision" AS source_revision
      INNER JOIN public."whatsapp_session_handoff" AS source_handoff
        ON source_handoff."session_id" = source_revision."session_id"
       AND source_handoff."source_revision_id" = source_revision."revision_id"
      WHERE source_revision."session_id" = p_worker_id
        AND source_revision."revision_id" = v_header_active_revision_id
        AND source_revision."provider" = lower(trim(p_provider))
        AND source_revision."status" IN ('staging', 'validating', 'active')
        AND source_revision."writer_generation" = p_generation
        AND source_revision."writer_epoch" = p_writer_epoch
        AND source_revision."capability_hash" = v_capability_hash
        AND source_handoff."lifecycle_operation_id" = v_lifecycle_operation_id
        AND source_handoff."source_provider" = lower(trim(p_provider))
        AND source_handoff."target_provider" <> lower(trim(p_provider))
        AND source_handoff."target_revision_id" IS NOT NULL
        AND source_handoff."target_revision_id" <>
          source_handoff."source_revision_id"
        AND source_handoff."state" IN ('requested', 'draining')
        AND source_handoff."error_code" IS NULL
        AND source_handoff."source_checkpoint_checksum_sha256" IS NULL
        AND source_handoff."source_checkpoint_size_bytes" IS NULL
        AND source_handoff."source_checkpoint_record_count" IS NULL
        AND source_handoff."source_drained_at" IS NULL
        AND source_handoff."point_of_no_return_at" IS NULL
        AND source_handoff."pre_activation_artifact_id" IS NULL
        AND source_handoff."recovery_state" = 'none'
        AND source_handoff."recovery_operation_id" IS NULL
      FOR SHARE OF source_revision, source_handoff;

      v_source_handoff_restart_authorized := COALESCE(
        v_source_handoff_restart_authorized,
        false
      );
    END IF;
  END IF;

  IF v_worker_status_id = '019a930d-c6f6-766d-9c84-46093814d8e0'::uuid
    AND (
      v_lifecycle_operation_id IS NULL
      OR (
        v_runtime."container_id" IS NOT DISTINCT FROM v_worker_container_id
        AND NOT v_source_handoff_restart_authorized
      )
    )
  THEN
    RETURN NEXT;
    RETURN;
  END IF;

  already_active := COALESCE(
    v_runtime."connection_epoch" = p_connection_epoch::text
      AND v_runtime."source_provider" = lower(trim(p_provider))
      AND v_runtime."session_writer_epoch" = p_writer_epoch
      AND v_runtime."connection_sequence" > 0,
    false
  );

  IF already_active THEN
    connection_sequence := v_runtime."connection_sequence";
  ELSE
    UPDATE public."worker_runtime" AS runtime
    SET "connection_epoch" = p_connection_epoch::text,
        "connection_sequence" = runtime."connection_sequence" + 1,
        "source_provider" = lower(trim(p_provider)),
        "connection_activated_at" = clock_timestamp(),
        "updated_at" = clock_timestamp()
    WHERE runtime."worker_id" = p_worker_id
      AND (
        runtime."container_id" = trim(p_container_id)
        OR runtime."container_id" LIKE trim(p_container_id) || '%'
      )
      AND runtime."runtime_generation" = p_generation
      AND runtime."runtime_capability_hash" = v_capability_hash
      AND runtime."session_storage" = v_worker_storage
      AND runtime."session_writer_epoch" = p_writer_epoch
    RETURNING runtime."connection_sequence" INTO connection_sequence;

    IF connection_sequence IS NULL THEN
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  IF v_worker_storage = 'postgres' THEN
    INSERT INTO public."whatsapp_session" (
      "session_id", "provider", "state", "generation",
      "epoch", "capability_hash", "created_at", "updated_at"
    ) VALUES (
      p_worker_id, lower(trim(p_provider)), 'empty', p_generation,
      p_writer_epoch, v_capability_hash, clock_timestamp(), clock_timestamp()
    )
    ON CONFLICT ("session_id") DO UPDATE
    SET "generation" = EXCLUDED."generation",
        "epoch" = EXCLUDED."epoch",
        "capability_hash" = EXCLUDED."capability_hash",
        "updated_at" = clock_timestamp()
    WHERE public."whatsapp_session"."generation" <= EXCLUDED."generation"
    RETURNING "provider", "generation", "epoch", "capability_hash"
    INTO v_header_provider, v_header_generation, v_header_writer_epoch,
      v_header_capability_hash;

    IF NOT FOUND
      OR NOT v_header_allows_provider
      OR v_header_generation <> p_generation
      OR v_header_writer_epoch IS DISTINCT FROM p_writer_epoch
      OR v_header_capability_hash IS DISTINCT FROM v_capability_hash
    THEN
      RAISE EXCEPTION 'whatsapp session header fence conflict'
        USING ERRCODE = '40001';
    END IF;

    UPDATE public."whatsapp_session_revision" AS revision
    SET "writer_generation" = p_generation,
        "writer_epoch" = p_writer_epoch,
        "capability_hash" = v_capability_hash
    WHERE revision."session_id" = p_worker_id
      AND revision."status" IN ('staging', 'validating', 'active')
      AND (
        revision."revision_id" = (
          SELECT session."active_revision_id"
          FROM public."whatsapp_session" AS session
          WHERE session."session_id" = p_worker_id
            AND session."provider" = lower(trim(p_provider))
        )
        OR revision."revision_id" IN (
          SELECT handoff."target_revision_id"
          FROM public."whatsapp_session_handoff" AS handoff
          WHERE handoff."session_id" = p_worker_id
            AND handoff."target_provider" = lower(trim(p_provider))
            AND handoff."state" IN (
              'requested', 'draining', 'transforming', 'hydrating',
              'validating', 'promoting'
            )
        )
        OR revision."revision_id" IN (
          SELECT handoff."source_revision_id"
          FROM public."whatsapp_session_handoff" AS handoff
          WHERE handoff."session_id" = p_worker_id
            AND handoff."target_provider" = lower(trim(p_provider))
            AND handoff."state" IN (
              'requested', 'draining', 'transforming', 'hydrating',
              'validating', 'promoting'
            )
        )
      );
  END IF;

  activated := true;
  RETURN NEXT;
END;
$function$;

REVOKE ALL ON FUNCTION public.activate_whatsapp_runtime_fence(
  uuid, uuid, text, integer, uuid, text, text, uuid
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.activate_whatsapp_runtime_fence(
  uuid, uuid, text, integer, uuid, text, text, uuid
) TO whatsapp_session_runtime;
