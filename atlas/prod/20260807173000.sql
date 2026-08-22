-- A deterministic source prepare rejection can happen before the durable
-- drain acknowledgement while the provider process has already fenced its
-- local runtime.  Restore the still-authoritative active source revision and
-- schedule the existing recovery workflow atomically instead of leaving the
-- lifecycle in `requested` forever.

CREATE OR REPLACE FUNCTION public.fail_whatsapp_handoff_before_source_drain(
  p_session_id uuid,
  p_account_id uuid,
  p_lifecycle_operation_id uuid,
  p_handoff_id uuid,
  p_source_provider text,
  p_target_provider text,
  p_source_revision_id bigint,
  p_target_revision_id bigint,
  p_runtime_generation integer,
  p_source_container_id text,
  p_error_code text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_source_worker_type uuid;
  v_worker public.worker%ROWTYPE;
  v_runtime public.worker_runtime%ROWTYPE;
  v_lease public.whatsapp_session_lease%ROWTYPE;
  v_session public.whatsapp_session%ROWTYPE;
  v_source_revision public.whatsapp_session_revision%ROWTYPE;
  v_target_revision public.whatsapp_session_revision%ROWTYPE;
  v_handoff public.whatsapp_session_handoff%ROWTYPE;
BEGIN
  p_source_provider := lower(trim(p_source_provider));
  p_target_provider := lower(trim(p_target_provider));
  p_source_container_id := lower(trim(p_source_container_id));
  p_error_code := lower(trim(p_error_code));

  IF p_session_id IS NULL
    OR p_account_id IS NULL
    OR p_lifecycle_operation_id IS NULL
    OR p_handoff_id IS NULL
    OR p_source_provider IS NULL
    OR p_target_provider IS NULL
    OR p_source_provider NOT IN ('baileys', 'wwebjs', 'whatsmeow')
    OR p_target_provider NOT IN ('baileys', 'wwebjs', 'whatsmeow')
    OR p_source_provider = p_target_provider
    OR p_source_revision_id IS NULL
    OR p_source_revision_id <= 0
    OR p_target_revision_id IS NULL
    OR p_target_revision_id <= 0
    OR p_target_revision_id = p_source_revision_id
    OR p_runtime_generation IS NULL
    OR p_runtime_generation <= 0
    OR p_source_container_id IS NULL
    OR p_source_container_id !~ '^[0-9a-f]{12,64}$'
    OR p_error_code IS NULL
    OR p_error_code !~ '^[a-z0-9_.:-]{1,100}$'
  THEN
    RETURN false;
  END IF;

  v_source_worker_type := CASE p_source_provider
    WHEN 'baileys' THEN '019a930d-c6f6-766d-9c84-53307d4159a1'::uuid
    WHEN 'wwebjs' THEN '019a930d-c6f6-766d-9c84-62b9c3e7d1f0'::uuid
    WHEN 'whatsmeow' THEN 'e80ad183-2b46-4628-9105-a036f2d28720'::uuid
  END;

  PERFORM set_config('app.whatsapp_session_id', p_session_id::text, true);

  -- Global lifecycle lock order: worker -> runtime -> lease -> session ->
  -- revisions -> handoff.  No network or queue work happens in this function.
  SELECT worker.*
  INTO v_worker
  FROM public.worker AS worker
  WHERE worker.worker_id = p_session_id
  FOR UPDATE;
  IF NOT FOUND
    OR v_worker.account_id IS DISTINCT FROM p_account_id
    OR v_worker.worker_type_id IS DISTINCT FROM v_source_worker_type
    OR v_worker.worker_status_id IS DISTINCT FROM
      '019a930d-c6f6-766d-9c84-46093814d8e0'::uuid
    OR v_worker.lifecycle_operation_id IS DISTINCT FROM p_lifecycle_operation_id
    OR v_worker.session_storage IS DISTINCT FROM 'postgres'
    OR v_worker.container_id IS NULL
    OR lower(v_worker.container_id) IS DISTINCT FROM p_source_container_id
    OR v_worker.deleted_at IS NOT NULL
  THEN
    RETURN false;
  END IF;

  SELECT runtime.*
  INTO v_runtime
  FROM public.worker_runtime AS runtime
  WHERE runtime.worker_id = p_session_id
  FOR UPDATE;
  IF NOT FOUND
    OR v_runtime.container_id IS NULL
    OR lower(v_runtime.container_id) IS DISTINCT FROM p_source_container_id
    OR v_runtime.runtime_generation IS DISTINCT FROM p_runtime_generation
    OR v_runtime.session_storage IS DISTINCT FROM 'postgres'
    OR v_runtime.session_volume_name IS NOT NULL
    OR v_runtime.source_provider IS DISTINCT FROM p_source_provider
    OR v_runtime.runtime_capability_hash IS NULL
    OR v_runtime.session_writer_epoch IS NULL
  THEN
    RETURN false;
  END IF;

  SELECT lease.*
  INTO v_lease
  FROM public.whatsapp_session_lease AS lease
  WHERE lease.session_id = p_session_id
  FOR UPDATE;
  -- A released lease is the normal terminal-prepare shape. An expired source
  -- owner is also safe because it has already lost write authority. Never
  -- turn an explicit rejection into recovery while its lease is still live.
  IF NOT FOUND
    OR v_lease.generation IS DISTINCT FROM p_runtime_generation
    OR (
      v_lease.owner_id IS NOT NULL
      AND (
        v_lease.provider IS DISTINCT FROM p_source_provider
        OR v_lease.epoch IS DISTINCT FROM v_runtime.session_writer_epoch
        OR v_lease.acquired_at IS NULL
        OR v_lease.heartbeat_at IS NULL
        OR v_lease.expires_at IS NULL
        OR v_lease.expires_at > clock_timestamp()
      )
    )
    OR (
      v_lease.owner_id IS NULL
      AND (
        v_lease.provider IS NOT NULL
        OR v_lease.epoch IS NOT NULL
        OR v_lease.acquired_at IS NOT NULL
        OR v_lease.heartbeat_at IS NOT NULL
        OR v_lease.expires_at IS NOT NULL
      )
    )
  THEN
    RETURN false;
  END IF;

  SELECT session.*
  INTO v_session
  FROM public.whatsapp_session AS session
  WHERE session.session_id = p_session_id
  FOR UPDATE;
  IF NOT FOUND
    OR v_session.provider IS DISTINCT FROM p_source_provider
    OR v_session.active_revision_id IS DISTINCT FROM p_source_revision_id
    OR v_session.generation IS DISTINCT FROM p_runtime_generation
    OR v_session.epoch IS DISTINCT FROM v_runtime.session_writer_epoch
    OR v_session.capability_hash IS DISTINCT FROM v_runtime.runtime_capability_hash
    OR v_session.state NOT IN ('handoff', 'ready')
  THEN
    RETURN false;
  END IF;

  SELECT revision.*
  INTO v_source_revision
  FROM public.whatsapp_session_revision AS revision
  WHERE revision.session_id = p_session_id
    AND revision.revision_id = p_source_revision_id
  FOR UPDATE;
  IF NOT FOUND
    OR v_source_revision.provider IS DISTINCT FROM p_source_provider
    OR v_source_revision.status IS DISTINCT FROM 'active'
    OR v_source_revision.writer_generation IS DISTINCT FROM p_runtime_generation
    OR v_source_revision.writer_epoch IS DISTINCT FROM v_runtime.session_writer_epoch
    OR v_source_revision.capability_hash IS DISTINCT FROM v_runtime.runtime_capability_hash
  THEN
    RETURN false;
  END IF;

  SELECT revision.*
  INTO v_target_revision
  FROM public.whatsapp_session_revision AS revision
  WHERE revision.session_id = p_session_id
    AND revision.revision_id = p_target_revision_id
  FOR UPDATE;
  IF NOT FOUND
    OR v_target_revision.provider IS DISTINCT FROM p_target_provider
    OR v_target_revision.source IS DISTINCT FROM 'handoff'
    OR v_target_revision.writer_generation IS DISTINCT FROM p_runtime_generation
    OR v_target_revision.writer_epoch IS DISTINCT FROM v_runtime.session_writer_epoch
    OR v_target_revision.capability_hash IS DISTINCT FROM v_runtime.runtime_capability_hash
    OR v_target_revision.status NOT IN ('staging', 'failed')
  THEN
    RETURN false;
  END IF;

  SELECT handoff.*
  INTO v_handoff
  FROM public.whatsapp_session_handoff AS handoff
  WHERE handoff.session_id = p_session_id
    AND handoff.handoff_id = p_handoff_id
  FOR UPDATE;
  IF NOT FOUND
    OR v_handoff.lifecycle_operation_id IS DISTINCT FROM p_lifecycle_operation_id
    OR v_handoff.source_provider IS DISTINCT FROM p_source_provider
    OR v_handoff.target_provider IS DISTINCT FROM p_target_provider
    OR v_handoff.source_revision_id IS DISTINCT FROM p_source_revision_id
    OR v_handoff.target_revision_id IS DISTINCT FROM p_target_revision_id
  THEN
    RETURN false;
  END IF;

  -- A lost response after this function committed is safe to replay while
  -- recovery has not yet taken ownership of the worker lifecycle.
  IF v_handoff.state = 'failed' THEN
    RETURN v_session.state = 'ready'
      AND v_source_revision.status = 'active'
      AND v_target_revision.status = 'failed'
      AND v_handoff.error_code IS NOT DISTINCT FROM p_error_code
      AND v_handoff.recovery_state IN ('pending', 'dispatching', 'running');
  END IF;

  IF v_session.state <> 'handoff'
    OR v_target_revision.status <> 'staging'
    OR v_handoff.state NOT IN ('requested', 'draining')
    OR v_handoff.error_code IS NOT NULL
    OR v_handoff.source_checkpoint_checksum_sha256 IS NOT NULL
    OR v_handoff.source_checkpoint_size_bytes IS NOT NULL
    OR v_handoff.source_checkpoint_record_count IS NOT NULL
    OR v_handoff.source_drained_at IS NOT NULL
    OR v_handoff.point_of_no_return_at IS NOT NULL
    OR v_handoff.pre_activation_artifact_id IS NOT NULL
    OR v_handoff.completed_at IS NOT NULL
    OR v_handoff.recovery_state <> 'none'
    OR v_handoff.recovery_operation_id IS NOT NULL
  THEN
    RETURN false;
  END IF;

  UPDATE public.whatsapp_session_revision AS target_revision
  SET status = 'failed',
      error_code = p_error_code,
      retired_at = clock_timestamp()
  WHERE target_revision.session_id = p_session_id
    AND target_revision.revision_id = p_target_revision_id
    AND target_revision.provider = p_target_provider
    AND target_revision.status = 'staging';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'whatsapp handoff target revision changed before pre-drain failure'
      USING ERRCODE = '40001';
  END IF;

  UPDATE public.whatsapp_session AS session
  SET state = 'ready',
      last_error_at = clock_timestamp(),
      updated_at = clock_timestamp()
  WHERE session.session_id = p_session_id
    AND session.provider = p_source_provider
    AND session.state = 'handoff'
    AND session.active_revision_id = p_source_revision_id
    AND session.generation = p_runtime_generation
    AND session.epoch = v_runtime.session_writer_epoch
    AND session.capability_hash = v_runtime.runtime_capability_hash;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'whatsapp source session changed before pre-drain failure'
      USING ERRCODE = '40001';
  END IF;

  UPDATE public.whatsapp_session_handoff AS handoff
  SET state = 'failed',
      error_code = p_error_code,
      updated_at = clock_timestamp(),
      completed_at = clock_timestamp()
  WHERE handoff.session_id = p_session_id
    AND handoff.handoff_id = p_handoff_id
    AND handoff.lifecycle_operation_id = p_lifecycle_operation_id
    AND handoff.state IN ('requested', 'draining')
    AND handoff.source_drained_at IS NULL
    AND handoff.point_of_no_return_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'whatsapp handoff changed before pre-drain failure'
      USING ERRCODE = '40001';
  END IF;

  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.fail_whatsapp_handoff_before_source_drain(
  uuid, uuid, uuid, uuid, text, text, bigint, bigint, integer, text, text
) FROM PUBLIC;
