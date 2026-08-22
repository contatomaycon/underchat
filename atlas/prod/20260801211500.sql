-- A recreating channel may activate only the successor runtime already bound
-- to worker_runtime. The previous runtime remains fenced while its container
-- still matches the control-plane pointer in worker.container_id.
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
SET search_path = pg_catalog, public
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

  -- Global lock order is worker first, runtime second, warm lineage third
  -- (when present), and session header last.
  SELECT w."session_storage", w."worker_status_id", w."container_id",
    w."lifecycle_operation_id"
  INTO v_worker_storage, v_worker_status_id, v_worker_container_id,
    v_lifecycle_operation_id
  FROM public."worker" AS w
  WHERE w."worker_id" = p_worker_id
    AND w."account_id" = p_account_id
    AND w."worker_type_id" = v_expected_worker_type
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

  IF v_worker_status_id = '019a930d-c6f6-766d-9c84-46093814d8e0'::uuid
    AND (
      v_lifecycle_operation_id IS NULL
      OR v_runtime."container_id" IS NOT DISTINCT FROM v_worker_container_id
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
    SELECT session."provider", session."writer_generation",
      session."writer_epoch", session."capability_hash"
    INTO v_header_provider, v_header_generation, v_header_writer_epoch,
      v_header_capability_hash
    FROM public."worker_whatsapp_session" AS session
    WHERE session."worker_id" = p_worker_id
    FOR UPDATE;

    IF FOUND AND (
      v_header_provider <> lower(trim(p_provider))
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
    INSERT INTO public."worker_whatsapp_session" (
      "worker_id", "provider", "state", "writer_generation",
      "writer_epoch", "capability_hash", "created_at", "updated_at"
    ) VALUES (
      p_worker_id, lower(trim(p_provider)), 'empty', p_generation,
      p_writer_epoch, v_capability_hash, clock_timestamp(), clock_timestamp()
    )
    ON CONFLICT ("worker_id") DO UPDATE
    SET "writer_generation" = EXCLUDED."writer_generation",
        "writer_epoch" = EXCLUDED."writer_epoch",
        "capability_hash" = EXCLUDED."capability_hash",
        "updated_at" = clock_timestamp()
    WHERE public."worker_whatsapp_session"."provider" = EXCLUDED."provider"
      AND public."worker_whatsapp_session"."writer_generation"
        <= EXCLUDED."writer_generation"
    RETURNING "provider", "writer_generation", "writer_epoch", "capability_hash"
    INTO v_header_provider, v_header_generation, v_header_writer_epoch,
      v_header_capability_hash;

    IF NOT FOUND
      OR v_header_provider <> lower(trim(p_provider))
      OR v_header_generation <> p_generation
      OR v_header_writer_epoch IS DISTINCT FROM p_writer_epoch
      OR v_header_capability_hash IS DISTINCT FROM v_capability_hash
    THEN
      RAISE EXCEPTION 'whatsapp session header fence conflict'
        USING ERRCODE = '40001';
    END IF;
  END IF;

  activated := true;
  RETURN NEXT;
END;
$function$;
