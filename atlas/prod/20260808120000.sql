-- A target runtime can lose its PostgreSQL session lease after the source was
-- drained but before promotion.  The generic worker lifecycle journal must
-- not restart that stale target forever.  Reconcile the exact pre-PONR
-- handoff atomically and let the existing handoff trigger schedule the
-- preserved-source recovery operation.

CREATE OR REPLACE FUNCTION public.fail_stale_whatsapp_handoff_target(
  p_session_id uuid,
  p_account_id uuid,
  p_lifecycle_operation_id uuid
)
RETURNS TABLE(
  outcome text,
  handoff_id uuid,
  recovery_operation_id uuid,
  recovery_state text,
  error_code text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_error_code constant text :=
    'whatsapp_handoff_target_lease_expired_before_promotion';
  v_source_worker_type uuid;
  v_worker public.worker%ROWTYPE;
  v_runtime public.worker_runtime%ROWTYPE;
  v_lease public.whatsapp_session_lease%ROWTYPE;
  v_session public.whatsapp_session%ROWTYPE;
  v_source_revision public.whatsapp_session_revision%ROWTYPE;
  v_target_revision public.whatsapp_session_revision%ROWTYPE;
  v_handoff_probe public.whatsapp_session_handoff%ROWTYPE;
  v_handoff public.whatsapp_session_handoff%ROWTYPE;
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);
  PERFORM set_config('statement_timeout', '10s', true);

  IF p_session_id IS NULL
    OR p_account_id IS NULL
    OR p_lifecycle_operation_id IS NULL
  THEN
    RETURN QUERY SELECT 'not_applicable'::text,
      NULL::uuid, NULL::uuid, NULL::text, NULL::text;
    RETURN;
  END IF;

  PERFORM set_config('app.whatsapp_session_id', p_session_id::text, true);

  -- Global lifecycle lock order: worker -> runtime -> lease -> session ->
  -- revisions -> handoff. No Docker, Redis or Kafka work occurs here.
  SELECT owner.*
  INTO v_worker
  FROM public.worker AS owner
  WHERE owner.worker_id = p_session_id
  FOR UPDATE;
  IF NOT FOUND
    OR v_worker.account_id IS DISTINCT FROM p_account_id
    OR v_worker.session_storage IS DISTINCT FROM 'postgres'
    OR v_worker.deleted_at IS NOT NULL
  THEN
    RETURN QUERY SELECT 'not_applicable'::text,
      NULL::uuid, NULL::uuid, NULL::text, NULL::text;
    RETURN;
  END IF;

  SELECT runtime.*
  INTO v_runtime
  FROM public.worker_runtime AS runtime
  WHERE runtime.worker_id = p_session_id
  FOR UPDATE;

  SELECT lease.*
  INTO v_lease
  FROM public.whatsapp_session_lease AS lease
  WHERE lease.session_id = p_session_id
  FOR UPDATE;

  SELECT session.*
  INTO v_session
  FROM public.whatsapp_session AS session
  WHERE session.session_id = p_session_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_applicable'::text,
      NULL::uuid, NULL::uuid, NULL::text, NULL::text;
    RETURN;
  END IF;

  -- Read the immutable revision identities before taking their locks. The
  -- handoff row is locked and fully revalidated after both revision locks.
  SELECT handoff.*
  INTO v_handoff_probe
  FROM public.whatsapp_session_handoff AS handoff
  WHERE handoff.session_id = p_session_id
    AND handoff.lifecycle_operation_id = p_lifecycle_operation_id;
  IF NOT FOUND
    OR v_handoff_probe.source_revision_id IS NULL
    OR v_handoff_probe.target_revision_id IS NULL
    OR v_handoff_probe.source_revision_id = v_handoff_probe.target_revision_id
  THEN
    RETURN QUERY SELECT 'not_applicable'::text,
      NULL::uuid, NULL::uuid, NULL::text, NULL::text;
    RETURN;
  END IF;

  SELECT revision.*
  INTO v_source_revision
  FROM public.whatsapp_session_revision AS revision
  WHERE revision.session_id = p_session_id
    AND revision.revision_id = v_handoff_probe.source_revision_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_applicable'::text,
      NULL::uuid, NULL::uuid, NULL::text, NULL::text;
    RETURN;
  END IF;

  SELECT revision.*
  INTO v_target_revision
  FROM public.whatsapp_session_revision AS revision
  WHERE revision.session_id = p_session_id
    AND revision.revision_id = v_handoff_probe.target_revision_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_applicable'::text,
      NULL::uuid, NULL::uuid, NULL::text, NULL::text;
    RETURN;
  END IF;

  SELECT handoff.*
  INTO v_handoff
  FROM public.whatsapp_session_handoff AS handoff
  WHERE handoff.session_id = p_session_id
    AND handoff.handoff_id = v_handoff_probe.handoff_id
  FOR UPDATE;
  IF NOT FOUND
    OR v_handoff.lifecycle_operation_id IS DISTINCT FROM
      p_lifecycle_operation_id
    OR v_handoff.source_revision_id IS DISTINCT FROM
      v_handoff_probe.source_revision_id
    OR v_handoff.target_revision_id IS DISTINCT FROM
      v_handoff_probe.target_revision_id
    OR v_handoff.source_provider IS DISTINCT FROM
      v_handoff_probe.source_provider
    OR v_handoff.target_provider IS DISTINCT FROM
      v_handoff_probe.target_provider
  THEN
    RETURN QUERY SELECT 'not_applicable'::text,
      NULL::uuid, NULL::uuid, NULL::text, NULL::text;
    RETURN;
  END IF;

  v_source_worker_type := CASE v_handoff.source_provider
    WHEN 'baileys' THEN '019a930d-c6f6-766d-9c84-53307d4159a1'::uuid
    WHEN 'wwebjs' THEN '019a930d-c6f6-766d-9c84-62b9c3e7d1f0'::uuid
    WHEN 'whatsmeow' THEN 'e80ad183-2b46-4628-9105-a036f2d28720'::uuid
  END;

  -- A lost database response is replay-safe. Once this exact failure has
  -- assigned a distinct recovery UUID, that recovery owns the source forever,
  -- including terminal blocked/cancelled/completed states. Never resurrect
  -- the failed target journal after recovery has changed the worker lifecycle.
  IF v_handoff.state = 'failed' THEN
    IF v_handoff.error_code IS NOT DISTINCT FROM v_error_code
      AND v_handoff.point_of_no_return_at IS NULL
      AND v_handoff.pre_activation_artifact_id IS NULL
      AND v_handoff.completed_at IS NOT NULL
      AND v_handoff.recovery_state IN (
        'pending', 'dispatching', 'running',
        'blocked', 'cancelled', 'completed'
      )
      AND v_handoff.recovery_operation_id IS NOT NULL
      AND v_handoff.recovery_operation_id IS DISTINCT FROM
        p_lifecycle_operation_id
      AND v_handoff.recovery_next_attempt_at IS NOT NULL
      AND v_source_worker_type IS NOT NULL
      AND v_worker.worker_type_id IS NOT DISTINCT FROM v_source_worker_type
      AND v_session.provider IS NOT DISTINCT FROM v_handoff.source_provider
      AND v_session.state = 'ready'
      AND v_session.active_revision_id IS NOT DISTINCT FROM
        v_handoff.source_revision_id
      AND v_source_revision.provider IS NOT DISTINCT FROM
        v_handoff.source_provider
      AND v_source_revision.status = 'active'
      AND v_target_revision.provider IS NOT DISTINCT FROM
        v_handoff.target_provider
      AND v_target_revision.status = 'failed'
      AND v_target_revision.error_code IS NOT DISTINCT FROM v_error_code
      AND v_target_revision.promoted_at IS NULL
      AND v_target_revision.retired_at IS NOT NULL
    THEN
      RETURN QUERY SELECT 'recovery_owned'::text,
        v_handoff.handoff_id,
        v_handoff.recovery_operation_id,
        v_handoff.recovery_state::text,
        v_handoff.error_code::text;
      RETURN;
    END IF;

    RETURN QUERY SELECT 'not_applicable'::text,
      v_handoff.handoff_id, NULL::uuid,
      v_handoff.recovery_state::text, v_handoff.error_code::text;
    RETURN;
  END IF;

  -- This is deliberately a pre-PONR rollback only. A live lease, a promoted
  -- target, or any activation evidence makes the function a no-op.
  IF v_worker.worker_status_id IS DISTINCT FROM
      '019a930d-c6f6-766d-9c84-46093814d8e0'::uuid
    OR v_worker.lifecycle_operation_id IS DISTINCT FROM
      p_lifecycle_operation_id
    OR v_runtime.session_storage IS DISTINCT FROM 'postgres'
    OR v_runtime.session_volume_name IS NOT NULL
    OR v_runtime.container_id IS NULL
    OR v_runtime.runtime_generation IS NULL
    OR v_runtime.runtime_generation <= 0
    OR v_runtime.runtime_capability_hash IS NULL
    OR v_runtime.session_writer_epoch IS NULL
    OR v_handoff.state NOT IN ('hydrating', 'validating')
    OR v_handoff.error_code IS NOT NULL
    OR v_handoff.source_drained_at IS NULL
    OR v_handoff.source_checkpoint_checksum_sha256 IS NULL
    OR v_handoff.source_checkpoint_size_bytes IS NULL
    OR v_handoff.source_checkpoint_size_bytes <= 0
    OR v_handoff.source_checkpoint_record_count IS NULL
    OR v_handoff.source_checkpoint_record_count <= 0
    OR v_handoff.point_of_no_return_at IS NOT NULL
    OR v_handoff.pre_activation_artifact_id IS NOT NULL
    OR v_handoff.completed_at IS NOT NULL
    OR v_handoff.recovery_state <> 'none'
    OR v_handoff.recovery_operation_id IS NOT NULL
    OR v_handoff.source_provider = v_handoff.target_provider
    OR v_source_worker_type IS NULL
    OR v_worker.worker_type_id IS DISTINCT FROM v_source_worker_type
    OR v_runtime.source_provider IS DISTINCT FROM v_handoff.target_provider
    OR v_runtime.recreate_bootstrap_operation_id IS DISTINCT FROM
      p_lifecycle_operation_id
    OR v_runtime.recreate_bootstrap_runtime_generation IS DISTINCT FROM
      v_runtime.runtime_generation
    OR lower(trim(v_runtime.recreate_bootstrap_container_id)) IS DISTINCT FROM
      lower(trim(v_runtime.container_id))
    OR v_runtime.recreate_bootstrap_started_at IS NULL
    OR v_runtime.recreate_retired_operation_id IS NOT NULL
    OR v_runtime.recreate_retired_runtime_generation IS NOT NULL
    OR v_runtime.recreate_retired_container_id IS NOT NULL
    OR v_runtime.recreate_retired_at IS NOT NULL
    OR v_runtime.native_connection_online_acknowledged IS NOT FALSE
    OR v_session.provider IS DISTINCT FROM v_handoff.source_provider
    OR v_session.state <> 'handoff'
    OR v_session.active_revision_id IS DISTINCT FROM
      v_handoff.source_revision_id
    OR v_session.previous_revision_id IS NOT NULL
    OR v_session.generation IS DISTINCT FROM v_runtime.runtime_generation
    OR v_session.epoch IS DISTINCT FROM v_runtime.session_writer_epoch
    OR v_session.capability_hash IS DISTINCT FROM
      v_runtime.runtime_capability_hash
    OR v_source_revision.provider IS DISTINCT FROM
      v_handoff.source_provider
    OR v_source_revision.status <> 'active'
    OR v_source_revision.writer_generation IS DISTINCT FROM
      v_session.generation
    OR v_source_revision.writer_epoch IS DISTINCT FROM v_session.epoch
    OR v_source_revision.capability_hash IS DISTINCT FROM
      v_session.capability_hash
    OR v_target_revision.provider IS DISTINCT FROM
      v_handoff.target_provider
    OR v_target_revision.source <> 'handoff'
    OR v_target_revision.status NOT IN ('staging', 'validating')
    OR v_target_revision.promoted_at IS NOT NULL
    OR v_target_revision.writer_generation IS DISTINCT FROM
      v_session.generation
    OR v_target_revision.writer_epoch IS DISTINCT FROM v_session.epoch
    OR v_target_revision.capability_hash IS DISTINCT FROM
      v_session.capability_hash
    OR v_lease.owner_id IS NULL
    OR v_lease.provider IS DISTINCT FROM v_handoff.target_provider
    OR v_lease.generation IS DISTINCT FROM v_session.generation
    OR v_lease.epoch IS DISTINCT FROM v_session.epoch
    OR v_lease.acquired_at IS NULL
    OR v_lease.heartbeat_at IS NULL
    OR v_lease.expires_at IS NULL
    OR v_lease.expires_at > clock_timestamp() - interval '5 seconds'
  THEN
    RETURN QUERY SELECT 'not_applicable'::text,
      v_handoff.handoff_id, NULL::uuid,
      v_handoff.recovery_state::text, v_handoff.error_code::text;
    RETURN;
  END IF;

  UPDATE public.whatsapp_session_revision AS target_revision
  SET status = 'failed',
      error_code = v_error_code,
      retired_at = clock_timestamp()
  WHERE target_revision.session_id = p_session_id
    AND target_revision.revision_id = v_handoff.target_revision_id
    AND target_revision.provider = v_handoff.target_provider
    AND target_revision.status IN ('staging', 'validating')
    AND target_revision.promoted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stale whatsapp handoff target changed before failure'
      USING ERRCODE = '40001';
  END IF;

  UPDATE public.whatsapp_session AS session
  SET provider = v_handoff.source_provider,
      state = 'ready',
      active_revision_id = v_handoff.source_revision_id,
      previous_revision_id = NULL,
      last_error_at = clock_timestamp(),
      updated_at = clock_timestamp()
  WHERE session.session_id = p_session_id
    AND session.provider = v_handoff.source_provider
    AND session.state = 'handoff'
    AND session.active_revision_id = v_handoff.source_revision_id
    AND session.previous_revision_id IS NULL
    AND session.generation = v_runtime.runtime_generation
    AND session.epoch = v_runtime.session_writer_epoch
    AND session.capability_hash = v_runtime.runtime_capability_hash;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'whatsapp handoff source changed before stale target failure'
      USING ERRCODE = '40001';
  END IF;

  UPDATE public.whatsapp_session_handoff AS handoff
  SET state = 'failed',
      error_code = v_error_code,
      updated_at = clock_timestamp(),
      completed_at = clock_timestamp()
  WHERE handoff.session_id = p_session_id
    AND handoff.handoff_id = v_handoff.handoff_id
    AND handoff.lifecycle_operation_id = p_lifecycle_operation_id
    AND handoff.state IN ('hydrating', 'validating')
    AND handoff.point_of_no_return_at IS NULL
    AND handoff.pre_activation_artifact_id IS NULL
    AND handoff.recovery_state = 'none'
    AND handoff.recovery_operation_id IS NULL
  RETURNING handoff.* INTO v_handoff;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'whatsapp handoff changed before stale target failure'
      USING ERRCODE = '40001';
  END IF;

  -- schedule_whatsapp_handoff_recovery() must run in this same UPDATE. Treat
  -- a missing or aliased recovery identity as an atomicity violation.
  IF v_handoff.recovery_state <> 'pending'
    OR v_handoff.recovery_operation_id IS NULL
    OR v_handoff.recovery_operation_id = p_lifecycle_operation_id
    OR v_handoff.recovery_next_attempt_at IS NULL
  THEN
    RAISE EXCEPTION 'stale whatsapp handoff recovery was not scheduled'
      USING ERRCODE = '55000';
  END IF;

  RETURN QUERY SELECT 'failed'::text,
    v_handoff.handoff_id,
    v_handoff.recovery_operation_id,
    v_handoff.recovery_state::text,
    v_handoff.error_code::text;
END;
$function$;

REVOKE ALL ON FUNCTION public.fail_stale_whatsapp_handoff_target(
  uuid, uuid, uuid
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fail_stale_whatsapp_handoff_target(
  uuid, uuid, uuid
) FROM whatsapp_session_runtime;
GRANT EXECUTE ON FUNCTION public.fail_stale_whatsapp_handoff_target(
  uuid, uuid, uuid
) TO CURRENT_USER;
