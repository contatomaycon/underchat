-- Durable, account-scoped decisions for failed WhatsApp provider handoffs.
--
-- A session reset cascades whatsapp_session_handoff by design. The resolution
-- is therefore owned by worker, not whatsapp_session, so retries and the UI can
-- still observe the exact operation after credentials have been discarded.
CREATE TABLE public.whatsapp_session_handoff_resolution (
  session_id uuid NOT NULL,
  handoff_id uuid NOT NULL,
  handoff_lifecycle_operation_id uuid NOT NULL,
  account_id uuid NOT NULL,
  source_provider varchar(20) NOT NULL,
  target_provider varchar(20) NOT NULL,
  source_revision_id bigint NOT NULL,
  target_revision_id bigint,
  action varchar(20) NOT NULL,
  state varchar(20) NOT NULL,
  operation_id uuid NOT NULL,
  last_error_code varchar(100),
  requested_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  cleanup_finalized_at timestamptz,
  completed_at timestamptz,
  CONSTRAINT whatsapp_session_handoff_resolution_pk
    PRIMARY KEY (session_id, handoff_id),
  CONSTRAINT whatsapp_session_handoff_resolution_worker_fk
    FOREIGN KEY (session_id) REFERENCES public.worker(worker_id)
    ON DELETE CASCADE,
  CONSTRAINT whatsapp_session_handoff_resolution_provider_check CHECK (
    source_provider IN ('baileys', 'wwebjs', 'whatsmeow')
    AND target_provider IN ('baileys', 'wwebjs', 'whatsmeow')
    AND source_provider <> target_provider
  ),
  CONSTRAINT whatsapp_session_handoff_resolution_action_check
    CHECK (action IN ('return', 'discard')),
  CONSTRAINT whatsapp_session_handoff_resolution_state_check
    CHECK (state IN ('running', 'completed')),
  CONSTRAINT whatsapp_session_handoff_resolution_completion_check CHECK (
    (state = 'completed' AND completed_at IS NOT NULL)
    OR (state = 'running' AND completed_at IS NULL)
  )
) WITH (fillfactor = 90);

CREATE UNIQUE INDEX whatsapp_session_handoff_resolution_operation_uidx
ON public.whatsapp_session_handoff_resolution (session_id, operation_id);

CREATE INDEX whatsapp_session_handoff_resolution_pending_idx
ON public.whatsapp_session_handoff_resolution (
  session_id, updated_at, handoff_id
)
WHERE state = 'running';

ALTER TABLE public.whatsapp_session_handoff_resolution ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_session_handoff_resolution FORCE ROW LEVEL SECURITY;

CREATE POLICY whatsapp_session_handoff_resolution_owner
ON public.whatsapp_session_handoff_resolution
FOR ALL
USING (
  current_user = pg_catalog.pg_get_userbyid((
    SELECT relowner
    FROM pg_catalog.pg_class
    WHERE oid = 'public.whatsapp_session'::regclass
  ))
)
WITH CHECK (
  current_user = pg_catalog.pg_get_userbyid((
    SELECT relowner
    FROM pg_catalog.pg_class
    WHERE oid = 'public.whatsapp_session'::regclass
  ))
);

CREATE OR REPLACE FUNCTION public.whatsapp_handoff_source_runtime_is_restored(
  p_session_id uuid,
  p_account_id uuid,
  p_source_provider text,
  p_source_revision_id bigint
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.worker AS worker
    JOIN public.worker_runtime AS runtime
      ON runtime.worker_id = worker.worker_id
    JOIN public.whatsapp_session AS session
      ON session.session_id = worker.worker_id
    JOIN public.whatsapp_session_lease AS lease
      ON lease.session_id = worker.worker_id
    WHERE worker.worker_id = p_session_id
      AND worker.account_id = p_account_id
      AND worker.deleted_at IS NULL
      AND worker.session_storage = 'postgres'
      AND worker.worker_type_id = CASE p_source_provider
        WHEN 'baileys' THEN '019a930d-c6f6-766d-9c84-53307d4159a1'::uuid
        WHEN 'wwebjs' THEN '019a930d-c6f6-766d-9c84-62b9c3e7d1f0'::uuid
        WHEN 'whatsmeow' THEN 'e80ad183-2b46-4628-9105-a036f2d28720'::uuid
        ELSE NULL::uuid
      END
      AND worker.worker_status_id = '019a930d-c6f6-766d-9c84-30af6ecc33b2'::uuid
      AND worker.lifecycle_operation_id IS NULL
      AND worker.container_id IS NOT NULL
      AND runtime.container_id = worker.container_id
      AND runtime.session_storage = 'postgres'
      AND runtime.source_provider = p_source_provider
      AND runtime.connection_activated_at IS NOT NULL
      AND runtime.native_connection_online_acknowledged
      AND session.provider = p_source_provider
      AND session.state = 'ready'
      AND session.active_revision_id = p_source_revision_id
      AND session.generation = runtime.runtime_generation
      AND session.epoch IS NOT NULL
      AND runtime.session_writer_epoch = session.epoch
      AND session.capability_hash IS NOT NULL
      AND runtime.runtime_capability_hash = session.capability_hash
      AND lease.provider = p_source_provider
      AND lease.owner_id IS NOT NULL
      AND lease.owner_id = runtime.native_connection_status_lease_owner_id
      AND lease.fencing_token > 0
      AND lease.fencing_token = runtime.native_connection_status_fencing_token
      AND lease.generation = runtime.runtime_generation
      AND lease.epoch = runtime.session_writer_epoch
      AND lease.expires_at > clock_timestamp() + interval '5 seconds'
  );
$function$;

REVOKE ALL ON FUNCTION public.whatsapp_handoff_source_runtime_is_restored(
  uuid, uuid, text, bigint
) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.reconcile_whatsapp_handoff_resolution(
  p_session_id uuid,
  p_account_id uuid,
  p_handoff_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_count integer;
BEGIN
  -- Serialize every reconciliation behind the canonical lifecycle root. The
  -- claim/finalize paths lock worker before runtime/session/handoff/resolution;
  -- taking the same first lock here prevents a resolution -> worker inversion
  -- when a status read races a return, discard, or a new provider request.
  PERFORM 1
  FROM public.worker AS worker
  WHERE worker.worker_id = p_session_id
    AND worker.account_id = p_account_id
    AND worker.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  UPDATE public.whatsapp_session_handoff_resolution AS resolution
  SET state = 'completed',
      completed_at = COALESCE(resolution.completed_at, clock_timestamp()),
      last_error_code = NULL,
      updated_at = clock_timestamp()
  FROM public.worker AS worker
  WHERE resolution.session_id = p_session_id
    AND resolution.account_id = p_account_id
    AND (p_handoff_id IS NULL OR resolution.handoff_id = p_handoff_id)
    AND resolution.state = 'running'
    AND worker.worker_id = resolution.session_id
    AND worker.account_id = resolution.account_id
    AND worker.deleted_at IS NULL
    AND (
      (
        resolution.action = 'return'
        AND public.whatsapp_handoff_source_runtime_is_restored(
          resolution.session_id,
          resolution.account_id,
          resolution.source_provider,
          resolution.source_revision_id
        )
      )
      OR
      (
        resolution.action = 'discard'
        AND resolution.cleanup_finalized_at IS NOT NULL
        AND worker.worker_type_id = CASE resolution.target_provider
          WHEN 'baileys' THEN '019a930d-c6f6-766d-9c84-53307d4159a1'::uuid
          WHEN 'wwebjs' THEN '019a930d-c6f6-766d-9c84-62b9c3e7d1f0'::uuid
          WHEN 'whatsmeow' THEN 'e80ad183-2b46-4628-9105-a036f2d28720'::uuid
          ELSE NULL::uuid
        END
        AND worker.lifecycle_operation_id IS NULL
        AND worker.worker_status_id NOT IN (
          '019a930d-c6f6-766d-9c84-437433031776'::uuid,
          '019a930d-c6f6-766d-9c84-46093814d8e0'::uuid,
          '019a930d-c6f6-766d-9c84-4dc1777f8f69'::uuid
        )
        AND (
          NOT EXISTS (
            SELECT 1
            FROM public.whatsapp_session AS session
            WHERE session.session_id = resolution.session_id
          )
          OR EXISTS (
            SELECT 1
            FROM public.whatsapp_session AS session
            WHERE session.session_id = resolution.session_id
              AND session.provider = resolution.target_provider
          )
        )
      )
    );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.reconcile_whatsapp_handoff_resolution(
  uuid, uuid, uuid
) FROM PUBLIC;

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

  -- Canonical lifecycle lock order: worker -> runtime -> lease -> session ->
  -- active revision -> handoff -> durable resolution.
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
    RETURN QUERY SELECT
      CASE WHEN v_resolution.action = 'return'
        THEN 'idempotent'::text ELSE 'conflict'::text END,
      v_resolution.state::text,
      v_resolution.operation_id;
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

  INSERT INTO public.whatsapp_session_handoff_resolution (
    session_id, handoff_id, account_id, source_provider, target_provider,
    handoff_lifecycle_operation_id, source_revision_id, target_revision_id,
    action, state, operation_id,
    completed_at
  ) VALUES (
    p_session_id, p_handoff_id, p_account_id, v_handoff.source_provider,
    v_handoff.target_provider, v_handoff.lifecycle_operation_id,
    v_handoff.source_revision_id,
    v_handoff.target_revision_id, 'return',
    CASE WHEN v_restored THEN 'completed' ELSE 'running' END,
    p_operation_id,
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
  ELSE
    UPDATE public.whatsapp_session_handoff
    SET recovery_state = 'pending',
        recovery_operation_id = p_operation_id,
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
    p_operation_id;
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
    RETURN QUERY SELECT
      CASE WHEN v_resolution.action = 'discard'
        THEN 'idempotent'::text ELSE 'conflict'::text END,
      v_resolution.state::text,
      v_resolution.operation_id;
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
    RETURN QUERY SELECT 'source_runtime_not_restored'::text,
      NULL::text, NULL::uuid;
    RETURN;
  END IF;

  IF v_worker.worker_type_id <> (CASE v_handoff.source_provider
      WHEN 'baileys' THEN '019a930d-c6f6-766d-9c84-53307d4159a1'::uuid
      WHEN 'wwebjs' THEN '019a930d-c6f6-766d-9c84-62b9c3e7d1f0'::uuid
      WHEN 'whatsmeow' THEN 'e80ad183-2b46-4628-9105-a036f2d28720'::uuid
      ELSE NULL::uuid
    END)
    OR NOT public.whatsapp_handoff_source_runtime_is_restored(
      p_session_id, p_account_id, v_handoff.source_provider,
      v_handoff.source_revision_id
    ) THEN
    RETURN QUERY SELECT 'source_runtime_not_restored'::text,
      NULL::text, NULL::uuid;
    RETURN;
  END IF;

  INSERT INTO public.whatsapp_session_handoff_resolution (
    session_id, handoff_id, account_id, source_provider, target_provider,
    handoff_lifecycle_operation_id, source_revision_id, target_revision_id,
    action, state, operation_id
  ) VALUES (
    p_session_id, p_handoff_id, p_account_id, v_handoff.source_provider,
    v_handoff.target_provider, v_handoff.lifecycle_operation_id,
    v_handoff.source_revision_id,
    v_handoff.target_revision_id, 'discard', 'running', p_operation_id
  );

  -- Stop automatic rollback before changing lifecycle ownership.
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
    AND worker_status_id = '019a930d-c6f6-766d-9c84-30af6ecc33b2'::uuid
    AND lifecycle_operation_id IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'whatsapp handoff discard worker CAS changed'
      USING ERRCODE = '40001';
  END IF;

  -- Fence the old writer in the same transaction as the target lifecycle
  -- claim. Keep the runtime capability until the source container is removed:
  -- it is immutable identity evidence for the cleanup CAS, while the revoked
  -- lease already prevents every protocol write.
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

CREATE OR REPLACE FUNCTION public.finalize_whatsapp_handoff_discard_cleanup(
  p_session_id uuid,
  p_account_id uuid,
  p_handoff_id uuid,
  p_operation_id uuid,
  p_expected_runtime_generation integer,
  p_expected_container_id text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_worker record;
  v_runtime record;
  v_resolution record;
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
    OR v_worker.worker_status_id <> '019a930d-c6f6-766d-9c84-46093814d8e0'::uuid
    OR v_worker.lifecycle_operation_id <> p_operation_id THEN
    RETURN false;
  END IF;

  SELECT runtime.* INTO v_runtime
  FROM public.worker_runtime AS runtime
  WHERE runtime.worker_id = p_session_id
  FOR UPDATE;
  IF NOT FOUND
    OR v_runtime.session_storage <> 'postgres'
    OR v_runtime.runtime_generation <> p_expected_runtime_generation
    OR v_runtime.container_id IS DISTINCT FROM p_expected_container_id THEN
    RETURN false;
  END IF;

  PERFORM 1 FROM public.whatsapp_session_lease
  WHERE session_id = p_session_id FOR UPDATE;
  IF FOUND AND EXISTS (
    SELECT 1 FROM public.whatsapp_session_lease AS lease
    WHERE lease.session_id = p_session_id
      AND (lease.owner_id IS NOT NULL OR lease.provider IS NOT NULL
        OR lease.epoch IS NOT NULL OR lease.expires_at IS NOT NULL)
  ) THEN
    RETURN false;
  END IF;

  PERFORM 1 FROM public.whatsapp_session
  WHERE session_id = p_session_id FOR UPDATE;
  PERFORM 1
  FROM public.whatsapp_session_revision AS revision
  JOIN public.whatsapp_session AS session
    ON session.session_id = revision.session_id
   AND session.active_revision_id = revision.revision_id
  WHERE revision.session_id = p_session_id
  FOR UPDATE OF revision;
  PERFORM 1
  FROM public.whatsapp_session_handoff AS handoff
  WHERE handoff.session_id = p_session_id
    AND handoff.handoff_id = p_handoff_id
  FOR UPDATE;

  SELECT resolution.* INTO v_resolution
  FROM public.whatsapp_session_handoff_resolution AS resolution
  WHERE resolution.session_id = p_session_id
    AND resolution.handoff_id = p_handoff_id
  FOR UPDATE;
  IF NOT FOUND
    OR v_resolution.account_id <> p_account_id
    OR v_resolution.action <> 'discard'
    OR v_resolution.state <> 'running'
    OR v_resolution.operation_id <> p_operation_id
    OR v_worker.worker_type_id <> (CASE v_resolution.target_provider
      WHEN 'baileys' THEN '019a930d-c6f6-766d-9c84-53307d4159a1'::uuid
      WHEN 'wwebjs' THEN '019a930d-c6f6-766d-9c84-62b9c3e7d1f0'::uuid
      WHEN 'whatsmeow' THEN 'e80ad183-2b46-4628-9105-a036f2d28720'::uuid
      ELSE NULL::uuid
    END)
    OR v_runtime.source_provider <> v_resolution.source_provider THEN
    RETURN false;
  END IF;

  UPDATE public.worker_runtime
  SET runtime_capability_hash = NULL,
      session_writer_epoch = NULL,
      connection_epoch = NULL,
      source_provider = NULL,
      native_connection_online_acknowledged = false,
      connection_activated_at = NULL,
      updated_at = clock_timestamp()
  WHERE worker_id = p_session_id
    AND runtime_generation = p_expected_runtime_generation
    AND container_id IS NOT DISTINCT FROM p_expected_container_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  PERFORM set_config('app.whatsapp_session_id', p_session_id::text, true);
  DELETE FROM public.whatsapp_session_handoff
  WHERE session_id = p_session_id;
  DELETE FROM public.whatsapp_session
  WHERE session_id = p_session_id;
  DELETE FROM public.whatsapp_session_revision
  WHERE session_id = p_session_id;

  UPDATE public.whatsapp_session_handoff_resolution
  SET cleanup_finalized_at = COALESCE(cleanup_finalized_at, clock_timestamp()),
      updated_at = clock_timestamp()
  WHERE session_id = p_session_id
    AND handoff_id = p_handoff_id
    AND action = 'discard'
    AND state = 'running'
    AND operation_id = p_operation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'whatsapp handoff discard resolution changed'
      USING ERRCODE = '40001';
  END IF;
  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.finalize_whatsapp_handoff_discard_cleanup(
  uuid, uuid, uuid, uuid, integer, text
) FROM PUBLIC;

-- Reconcile completed decisions and reject a new provider change while any
-- previous failed handoff still needs a user decision or lifecycle finish.
CREATE OR REPLACE FUNCTION public.request_whatsapp_provider_handoff(
  p_session_id uuid,
  p_account_id uuid,
  p_source_provider text,
  p_target_provider text,
  p_lifecycle_operation_id uuid
)
RETURNS TABLE(
  handoff_id uuid,
  target_revision_id bigint,
  source_revision_id bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  PERFORM public.reconcile_whatsapp_handoff_resolution(
    p_session_id, p_account_id, NULL
  );

  IF EXISTS (
    SELECT 1
    FROM public.whatsapp_session_handoff AS handoff
    LEFT JOIN public.whatsapp_session_handoff_resolution AS resolution
      ON resolution.session_id = handoff.session_id
     AND resolution.handoff_id = handoff.handoff_id
    WHERE handoff.session_id = p_session_id
      AND handoff.state = 'failed'
      AND (resolution.session_id IS NULL OR resolution.state <> 'completed')
  ) OR EXISTS (
    SELECT 1
    FROM public.whatsapp_session_handoff_resolution AS resolution
    WHERE resolution.session_id = p_session_id
      AND resolution.state <> 'completed'
  ) THEN
    RAISE EXCEPTION 'previous whatsapp provider handoff requires resolution'
      USING ERRCODE = '55000';
  END IF;

  PERFORM set_config('app.whatsapp_schema_upgrade_bridge', '17', true);
  RETURN QUERY
  SELECT requested.handoff_id, requested.target_revision_id,
         requested.source_revision_id
  FROM public.request_whatsapp_provider_handoff_schema16(
    p_session_id, p_account_id, p_source_provider, p_target_provider,
    p_lifecycle_operation_id
  ) AS requested;
END;
$function$;

REVOKE ALL ON FUNCTION public.request_whatsapp_provider_handoff(
  uuid, uuid, text, text, uuid
) FROM PUBLIC;
