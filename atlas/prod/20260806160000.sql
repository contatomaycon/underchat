-- Make failed-provider recovery directly retryable and permit the explicitly
-- confirmed destructive fallback to supersede a still-running return.  Both
-- functions retain the canonical worker -> runtime -> lease -> session ->
-- revision -> handoff -> resolution lock order.

CREATE OR REPLACE FUNCTION public.resolve_whatsapp_provider_handoff_return(
  p_session_id uuid,
  p_account_id uuid,
  p_handoff_id uuid,
  p_operation_id uuid
)
RETURNS TABLE(outcome text, resolution_state text, operation_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_worker record;
  v_handoff record;
  v_resolution record;
  v_restored boolean;
  v_active_recovery boolean;
  v_effective_operation_id uuid;
BEGIN
  PERFORM set_config('lock_timeout', '10s', true);
  PERFORM set_config('statement_timeout', '20s', true);

  SELECT worker.* INTO v_worker
  FROM public.worker AS worker
  WHERE worker.worker_id = p_session_id
  FOR UPDATE;
  IF NOT FOUND OR v_worker.account_id <> p_account_id
    OR v_worker.deleted_at IS NOT NULL
    OR v_worker.session_storage <> 'postgres' THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::text, NULL::uuid;
    RETURN;
  END IF;

  PERFORM 1 FROM public.worker_runtime
  WHERE worker_id = p_session_id FOR UPDATE;
  PERFORM 1 FROM public.whatsapp_session_lease
  WHERE session_id = p_session_id FOR UPDATE;
  PERFORM 1 FROM public.whatsapp_session
  WHERE session_id = p_session_id FOR UPDATE;
  PERFORM 1
  FROM public.whatsapp_session_revision AS revision
  JOIN public.whatsapp_session AS session
    ON session.session_id = revision.session_id
   AND session.active_revision_id = revision.revision_id
  WHERE revision.session_id = p_session_id
  FOR UPDATE OF revision;

  SELECT handoff.* INTO v_handoff
  FROM public.whatsapp_session_handoff AS handoff
  WHERE handoff.session_id = p_session_id
    AND handoff.handoff_id = p_handoff_id
  FOR UPDATE;
  IF NOT FOUND THEN
    SELECT resolution.* INTO v_resolution
    FROM public.whatsapp_session_handoff_resolution AS resolution
    WHERE resolution.session_id = p_session_id
      AND resolution.handoff_id = p_handoff_id
    FOR UPDATE;
    IF FOUND AND v_resolution.action = 'return' THEN
      RETURN QUERY SELECT 'idempotent'::text,
        v_resolution.state::text, v_resolution.operation_id;
    ELSIF FOUND THEN
      RETURN QUERY SELECT 'conflict'::text,
        v_resolution.state::text, v_resolution.operation_id;
    ELSE
      RETURN QUERY SELECT 'not_found'::text, NULL::text, NULL::uuid;
    END IF;
    RETURN;
  END IF;

  SELECT resolution.* INTO v_resolution
  FROM public.whatsapp_session_handoff_resolution AS resolution
  WHERE resolution.session_id = p_session_id
    AND resolution.handoff_id = p_handoff_id
  FOR UPDATE;
  IF FOUND THEN
    IF v_resolution.action <> 'return' THEN
      RETURN QUERY SELECT 'conflict'::text,
        v_resolution.state::text, v_resolution.operation_id;
      RETURN;
    END IF;

    -- A user may explicitly retry a bounded/blocked return. Reopen only the
    -- same durable operation and only while its source revision still exists;
    -- this cannot replace a different recovery lifecycle.
    IF v_resolution.state = 'running'
      AND v_handoff.state = 'failed'
      AND v_handoff.recovery_state = 'blocked'
      AND EXISTS (
        SELECT 1
        FROM public.whatsapp_session AS session
        WHERE session.session_id = p_session_id
          AND session.provider = v_handoff.source_provider
          AND session.state = 'ready'
          AND session.active_revision_id = v_handoff.source_revision_id
      ) THEN
      UPDATE public.whatsapp_session_handoff
      SET recovery_state = 'pending',
          recovery_operation_id = v_resolution.operation_id,
          recovery_cleanup_required = NULL,
          recovery_from_generation = NULL,
          recovery_attempt_count = 0,
          recovery_next_attempt_at = clock_timestamp(),
          recovery_claim_token = NULL,
          recovery_claim_expires_at = NULL,
          recovery_last_error_code = NULL,
          recovery_started_at = NULL,
          recovery_completed_at = NULL,
          updated_at = clock_timestamp()
      WHERE session_id = p_session_id AND handoff_id = p_handoff_id;
    END IF;

    RETURN QUERY SELECT 'idempotent'::text,
      v_resolution.state::text, v_resolution.operation_id;
    RETURN;
  END IF;

  IF v_handoff.state <> 'failed' THEN
    RETURN QUERY SELECT
      CASE WHEN v_handoff.state = 'completed'
        THEN 'handoff_completed'::text ELSE 'handoff_in_progress'::text END,
      NULL::text,
      NULL::uuid;
    RETURN;
  END IF;

  IF v_handoff.lifecycle_operation_id IS NULL THEN
    RETURN QUERY SELECT 'source_revision_unavailable'::text,
      NULL::text, NULL::uuid;
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.whatsapp_session AS session
    WHERE session.session_id = p_session_id
      AND session.provider = v_handoff.source_provider
      AND session.state = 'ready'
      AND session.active_revision_id = v_handoff.source_revision_id
  ) THEN
    RETURN QUERY SELECT 'source_revision_unavailable'::text,
      NULL::text, NULL::uuid;
    RETURN;
  END IF;

  v_restored := public.whatsapp_handoff_source_runtime_is_restored(
    p_session_id, p_account_id, v_handoff.source_provider,
    v_handoff.source_revision_id
  );
  v_active_recovery := v_handoff.recovery_state IN (
    'pending', 'dispatching', 'running'
  ) AND v_handoff.recovery_operation_id IS NOT NULL;
  v_effective_operation_id := CASE
    WHEN v_active_recovery THEN v_handoff.recovery_operation_id
    ELSE p_operation_id
  END;

  INSERT INTO public.whatsapp_session_handoff_resolution (
    session_id, handoff_id, account_id, source_provider, target_provider,
    handoff_lifecycle_operation_id, source_revision_id, target_revision_id,
    action, state, operation_id, completed_at
  ) VALUES (
    p_session_id, p_handoff_id, p_account_id, v_handoff.source_provider,
    v_handoff.target_provider, v_handoff.lifecycle_operation_id,
    v_handoff.source_revision_id, v_handoff.target_revision_id, 'return',
    CASE WHEN v_restored THEN 'completed' ELSE 'running' END,
    v_effective_operation_id,
    CASE WHEN v_restored THEN clock_timestamp() ELSE NULL END
  );

  IF v_restored THEN
    UPDATE public.whatsapp_session_handoff
    SET recovery_state = 'completed',
        recovery_claim_token = NULL,
        recovery_claim_expires_at = NULL,
        recovery_last_error_code = NULL,
        recovery_completed_at = COALESCE(
          recovery_completed_at, clock_timestamp()
        ),
        updated_at = clock_timestamp()
    WHERE session_id = p_session_id AND handoff_id = p_handoff_id;
  ELSIF NOT v_active_recovery THEN
    UPDATE public.whatsapp_session_handoff
    SET recovery_state = 'pending',
        recovery_operation_id = v_effective_operation_id,
        recovery_cleanup_required = NULL,
        recovery_from_generation = NULL,
        recovery_attempt_count = 0,
        recovery_next_attempt_at = clock_timestamp(),
        recovery_claim_token = NULL,
        recovery_claim_expires_at = NULL,
        recovery_last_error_code = NULL,
        recovery_started_at = NULL,
        recovery_completed_at = NULL,
        updated_at = clock_timestamp()
    WHERE session_id = p_session_id AND handoff_id = p_handoff_id;
  END IF;

  RETURN QUERY SELECT 'claimed'::text,
    CASE WHEN v_restored THEN 'completed'::text ELSE 'running'::text END,
    v_effective_operation_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.resolve_whatsapp_provider_handoff_return(
  uuid, uuid, uuid, uuid
) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.resolve_whatsapp_provider_handoff_discard(
  p_session_id uuid,
  p_account_id uuid,
  p_handoff_id uuid,
  p_operation_id uuid,
  p_expected_server_id uuid
)
RETURNS TABLE(outcome text, resolution_state text, operation_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_worker record;
  v_handoff record;
  v_resolution record;
  v_runtime record;
  v_override_return boolean := false;
  v_runtime_found boolean := false;
  v_discard_runtime_identity_proven boolean := false;
BEGIN
  PERFORM set_config('lock_timeout', '10s', true);
  PERFORM set_config('statement_timeout', '20s', true);

  SELECT worker.* INTO v_worker
  FROM public.worker AS worker
  WHERE worker.worker_id = p_session_id
  FOR UPDATE;
  IF NOT FOUND OR v_worker.account_id <> p_account_id
    OR v_worker.deleted_at IS NOT NULL
    OR v_worker.session_storage <> 'postgres'
    OR v_worker.server_id IS DISTINCT FROM p_expected_server_id THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::text, NULL::uuid;
    RETURN;
  END IF;

  SELECT runtime.* INTO v_runtime
  FROM public.worker_runtime AS runtime
  WHERE runtime.worker_id = p_session_id
  FOR UPDATE;
  v_runtime_found := FOUND;
  PERFORM 1 FROM public.whatsapp_session_lease
  WHERE session_id = p_session_id FOR UPDATE;
  PERFORM 1 FROM public.whatsapp_session
  WHERE session_id = p_session_id FOR UPDATE;
  PERFORM 1
  FROM public.whatsapp_session_revision AS revision
  JOIN public.whatsapp_session AS session
    ON session.session_id = revision.session_id
   AND session.active_revision_id = revision.revision_id
  WHERE revision.session_id = p_session_id
  FOR UPDATE OF revision;

  SELECT handoff.* INTO v_handoff
  FROM public.whatsapp_session_handoff AS handoff
  WHERE handoff.session_id = p_session_id
    AND handoff.handoff_id = p_handoff_id
  FOR UPDATE;
  IF NOT FOUND THEN
    SELECT resolution.* INTO v_resolution
    FROM public.whatsapp_session_handoff_resolution AS resolution
    WHERE resolution.session_id = p_session_id
      AND resolution.handoff_id = p_handoff_id
    FOR UPDATE;
    IF FOUND AND v_resolution.action = 'discard' THEN
      RETURN QUERY SELECT 'idempotent'::text,
        v_resolution.state::text, v_resolution.operation_id;
    ELSIF FOUND THEN
      RETURN QUERY SELECT 'conflict'::text,
        v_resolution.state::text, v_resolution.operation_id;
    ELSE
      RETURN QUERY SELECT 'not_found'::text, NULL::text, NULL::uuid;
    END IF;
    RETURN;
  END IF;

  SELECT resolution.* INTO v_resolution
  FROM public.whatsapp_session_handoff_resolution AS resolution
  WHERE resolution.session_id = p_session_id
    AND resolution.handoff_id = p_handoff_id
  FOR UPDATE;
  IF FOUND THEN
    IF v_resolution.action = 'discard' THEN
      RETURN QUERY SELECT 'idempotent'::text,
        v_resolution.state::text, v_resolution.operation_id;
      RETURN;
    END IF;
    IF v_resolution.action = 'return' AND v_resolution.state = 'running' THEN
      v_override_return := true;
    ELSE
      RETURN QUERY SELECT 'conflict'::text,
        v_resolution.state::text, v_resolution.operation_id;
      RETURN;
    END IF;
  END IF;

  IF v_handoff.state <> 'failed' THEN
    RETURN QUERY SELECT
      CASE WHEN v_handoff.state = 'completed'
        THEN 'handoff_completed'::text ELSE 'handoff_in_progress'::text END,
      NULL::text,
      NULL::uuid;
    RETURN;
  END IF;

  IF v_handoff.lifecycle_operation_id IS NULL THEN
    RETURN QUERY SELECT 'source_runtime_not_restored'::text,
      NULL::text, NULL::uuid;
    RETURN;
  END IF;

  -- A destructive fallback does not require the old socket to be healthy or
  -- the source revision to be queryable. It does require a bound Postgres
  -- runtime whose durable source identity still names the original provider,
  -- plus a worker lifecycle state that this function can fence atomically.
  -- This deliberately blocks a cold/missing runtime rather than deleting an
  -- untracked container while a return recreate is still binding it.
  v_discard_runtime_identity_proven := v_runtime_found
    AND v_runtime.session_storage = 'postgres'
    AND v_runtime.container_id IS NOT NULL
    AND v_runtime.source_provider = v_handoff.source_provider
    AND v_worker.worker_type_id = (CASE v_handoff.source_provider
      WHEN 'baileys' THEN '019a930d-c6f6-766d-9c84-53307d4159a1'::uuid
      WHEN 'wwebjs' THEN '019a930d-c6f6-766d-9c84-62b9c3e7d1f0'::uuid
      WHEN 'whatsmeow' THEN 'e80ad183-2b46-4628-9105-a036f2d28720'::uuid
      ELSE NULL::uuid
    END)
    AND (
      (v_worker.worker_status_id = '019a930d-c6f6-766d-9c84-30af6ecc33b2'::uuid
        AND v_worker.lifecycle_operation_id IS NULL)
      OR
      (v_worker.worker_status_id = '019a930d-c6f6-766d-9c84-46093814d8e0'::uuid
        AND (
          (
            NOT v_override_return
            AND v_worker.lifecycle_operation_id = v_handoff.lifecycle_operation_id
          )
          OR
          (
            v_override_return
            AND (
              v_worker.lifecycle_operation_id = v_resolution.operation_id
              OR v_worker.lifecycle_operation_id = v_handoff.recovery_operation_id
            )
          )
        ))
    );
  IF NOT v_discard_runtime_identity_proven THEN
    IF v_override_return THEN
      RETURN QUERY SELECT 'return_recovery_quiescing'::text,
        v_resolution.state::text, v_resolution.operation_id;
    ELSE
      RETURN QUERY SELECT 'source_runtime_identity_unavailable'::text,
        NULL::text, NULL::uuid;
    END IF;
    RETURN;
  END IF;

  IF v_override_return THEN
    UPDATE public.whatsapp_session_handoff_resolution
    SET action = 'discard',
        state = 'running',
        operation_id = p_operation_id,
        last_error_code = NULL,
        requested_at = clock_timestamp(),
        updated_at = clock_timestamp(),
        cleanup_finalized_at = NULL,
        completed_at = NULL
    WHERE session_id = p_session_id
      AND handoff_id = p_handoff_id
      AND action = 'return'
      AND state = 'running'
      AND operation_id = v_resolution.operation_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'whatsapp handoff discard return override changed'
        USING ERRCODE = '40001';
    END IF;
  ELSE
    INSERT INTO public.whatsapp_session_handoff_resolution (
      session_id, handoff_id, account_id, source_provider, target_provider,
      handoff_lifecycle_operation_id, source_revision_id, target_revision_id,
      action, state, operation_id
    ) VALUES (
      p_session_id, p_handoff_id, p_account_id, v_handoff.source_provider,
      v_handoff.target_provider, v_handoff.lifecycle_operation_id,
      v_handoff.source_revision_id, v_handoff.target_revision_id,
      'discard', 'running', p_operation_id
    );
  END IF;

  -- Stop/revoke the return before transfering worker lifecycle ownership. A
  -- queued return command is then fenced by its old lifecycle operation.
  UPDATE public.whatsapp_session_handoff
  SET recovery_state = 'cancelled',
      recovery_operation_id = COALESCE(recovery_operation_id, p_operation_id),
      recovery_next_attempt_at = COALESCE(
        recovery_next_attempt_at, clock_timestamp()
      ),
      recovery_claim_token = NULL,
      recovery_claim_expires_at = NULL,
      recovery_last_error_code = NULL,
      recovery_completed_at = NULL,
      updated_at = clock_timestamp()
  WHERE session_id = p_session_id AND handoff_id = p_handoff_id;

  UPDATE public.worker
  SET worker_type_id = CASE v_handoff.target_provider
        WHEN 'baileys' THEN '019a930d-c6f6-766d-9c84-53307d4159a1'::uuid
        WHEN 'wwebjs' THEN '019a930d-c6f6-766d-9c84-62b9c3e7d1f0'::uuid
        WHEN 'whatsmeow' THEN 'e80ad183-2b46-4628-9105-a036f2d28720'::uuid
      END,
      worker_status_id = '019a930d-c6f6-766d-9c84-46093814d8e0'::uuid,
      lifecycle_operation_id = p_operation_id,
      number = NULL,
      connection_date = NULL,
      updated_at = clock_timestamp()
  WHERE worker_id = p_session_id
    AND account_id = p_account_id
    AND server_id = p_expected_server_id
    AND worker_type_id = v_worker.worker_type_id
    AND worker_status_id = v_worker.worker_status_id
    AND lifecycle_operation_id IS NOT DISTINCT FROM v_worker.lifecycle_operation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'whatsapp handoff discard worker CAS changed'
      USING ERRCODE = '40001';
  END IF;

  UPDATE public.whatsapp_session_lease
  SET owner_id = NULL,
      provider = NULL,
      fencing_token = fencing_token + 1,
      epoch = NULL,
      acquired_at = NULL,
      heartbeat_at = NULL,
      expires_at = NULL
  WHERE session_id = p_session_id;

  RETURN QUERY SELECT 'claimed'::text, 'running'::text, p_operation_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.resolve_whatsapp_provider_handoff_discard(
  uuid, uuid, uuid, uuid, uuid
) FROM PUBLIC;
