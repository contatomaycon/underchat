-- Preserve the sanitized runtime failure that caused a pre-activation
-- WhatsApp provider handoff rollback. Both durable records are updated by the
-- same fenced transaction so post-mortem diagnostics cannot disagree.

CREATE OR REPLACE FUNCTION public.rollback_whatsapp_session_revision(
  p_session_id uuid,
  p_candidate_revision_id bigint,
  p_previous_revision_id bigint,
  p_owner_id uuid,
  p_fencing_token bigint,
  p_generation integer,
  p_epoch uuid,
  p_capability text,
  p_error_code text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_source_provider text;
  v_target_provider text;
  v_target_source text;
  v_lifecycle_operation_id uuid;
  v_source_worker_type uuid;
  v_target_worker_type uuid;
  v_previous_provider text;
  v_previous_status text;
  v_previous_fingerprint bytea;
  v_previous_jid text;
  v_error_code text;
BEGIN
  v_error_code := CASE
    WHEN p_error_code ~* '^(handoff|whatsapp|wwebjs)_[a-z0-9_.-]{1,91}$'
      THEN p_error_code
    ELSE 'handoff_validation_failed'
  END;

  IF p_candidate_revision_id IS NULL OR p_previous_revision_id IS NULL
    OR p_candidate_revision_id = p_previous_revision_id
  THEN
    RAISE EXCEPTION 'invalid whatsapp session rollback revisions'
      USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('app.whatsapp_session_id', p_session_id::text, true);
  PERFORM 1
  FROM public.worker AS worker
  WHERE worker.worker_id = p_session_id
    AND worker.session_storage = 'postgres'
    AND worker.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'whatsapp worker is unavailable for rollback'
      USING ERRCODE = '55000';
  END IF;

  PERFORM public.begin_whatsapp_session_mutation(
    p_session_id,
    p_candidate_revision_id,
    p_owner_id,
    p_fencing_token,
    p_generation,
    p_epoch,
    p_capability
  );

  SELECT handoff.source_provider, handoff.target_provider,
    target_revision.source, handoff.lifecycle_operation_id
  INTO v_source_provider, v_target_provider, v_target_source,
    v_lifecycle_operation_id
  FROM public.whatsapp_session_handoff AS handoff
  JOIN public.whatsapp_session_revision AS target_revision
    ON target_revision.session_id = handoff.session_id
   AND target_revision.revision_id = handoff.target_revision_id
   AND target_revision.provider = handoff.target_provider
  WHERE handoff.session_id = p_session_id
    AND handoff.source_revision_id = p_previous_revision_id
    AND handoff.target_revision_id = p_candidate_revision_id
    AND handoff.state IN (
      'requested', 'draining', 'transforming', 'hydrating',
      'validating', 'promoting'
    )
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'whatsapp session rollback association is invalid'
      USING ERRCODE = '55000';
  END IF;

  v_source_worker_type := CASE v_source_provider
    WHEN 'baileys' THEN '019a930d-c6f6-766d-9c84-53307d4159a1'::uuid
    WHEN 'wwebjs' THEN '019a930d-c6f6-766d-9c84-62b9c3e7d1f0'::uuid
    WHEN 'whatsmeow' THEN 'e80ad183-2b46-4628-9105-a036f2d28720'::uuid
  END;
  v_target_worker_type := CASE v_target_provider
    WHEN 'baileys' THEN '019a930d-c6f6-766d-9c84-53307d4159a1'::uuid
    WHEN 'wwebjs' THEN '019a930d-c6f6-766d-9c84-62b9c3e7d1f0'::uuid
    WHEN 'whatsmeow' THEN 'e80ad183-2b46-4628-9105-a036f2d28720'::uuid
  END;

  UPDATE public.whatsapp_session_revision
  SET status = 'failed',
      error_code = v_error_code,
      retired_at = clock_timestamp()
  WHERE session_id = p_session_id
    AND revision_id = p_candidate_revision_id
    AND status IN ('staging', 'validating');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'candidate whatsapp session revision is not rollbackable'
      USING ERRCODE = '40001';
  END IF;

  PERFORM set_config('app.whatsapp_revision_id', p_previous_revision_id::text, true);
  SELECT revision.provider, revision.status, device.device_fingerprint, device.jid
  INTO v_previous_provider, v_previous_status, v_previous_fingerprint, v_previous_jid
  FROM public.whatsapp_session_revision AS revision
  LEFT JOIN public.whatsapp_device AS device
    ON device.session_id = revision.session_id
   AND device.revision_id = revision.revision_id
  WHERE revision.session_id = p_session_id
    AND revision.revision_id = p_previous_revision_id
    AND revision.status IN ('staging', 'validating', 'active', 'retired')
  FOR UPDATE OF revision;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'previous whatsapp session revision is unavailable'
      USING ERRCODE = '55000';
  END IF;

  UPDATE public.whatsapp_session_revision
  SET status = CASE
        WHEN v_previous_jid IS NOT NULL AND v_previous_fingerprint IS NOT NULL
          THEN 'active'
        WHEN v_previous_status = 'retired' THEN 'validating'
        ELSE v_previous_status
      END,
      error_code = NULL,
      retired_at = NULL,
      promoted_at = CASE
        WHEN v_previous_jid IS NOT NULL AND v_previous_fingerprint IS NOT NULL
          THEN COALESCE(promoted_at, clock_timestamp())
        ELSE promoted_at
      END
  WHERE session_id = p_session_id
    AND revision_id = p_previous_revision_id;

  UPDATE public.whatsapp_session
  SET provider = v_previous_provider,
      state = CASE
        WHEN v_previous_jid IS NOT NULL AND v_previous_fingerprint IS NOT NULL
          THEN 'ready'
        ELSE 'preparing'
      END,
      active_revision_id = p_previous_revision_id,
      previous_revision_id = NULL,
      active_device_fingerprint = v_previous_fingerprint,
      last_error_at = clock_timestamp(),
      updated_at = clock_timestamp()
  WHERE session_id = p_session_id
    AND generation = p_generation
    AND epoch = p_epoch
    AND active_revision_id = p_previous_revision_id
    AND previous_revision_id IS DISTINCT FROM p_candidate_revision_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'whatsapp session changed during rollback'
      USING ERRCODE = '40001';
  END IF;

  IF v_source_provider = v_target_provider
    AND v_target_source = 'secure_import'
    AND v_lifecycle_operation_id IS NULL
  THEN
    PERFORM 1
    FROM public.worker AS worker
    WHERE worker.worker_id = p_session_id
      AND worker.worker_type_id = v_source_worker_type
      AND worker.session_storage = 'postgres'
      AND worker.deleted_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'worker provider changed during whatsapp secure import rollback'
        USING ERRCODE = '40001';
    END IF;
  ELSE
    UPDATE public.worker AS worker
    SET worker_type_id = v_source_worker_type,
        updated_at = clock_timestamp()
    WHERE worker.worker_id = p_session_id
      AND worker.worker_type_id = v_source_worker_type
      AND worker.worker_status_id = '019a930d-c6f6-766d-9c84-46093814d8e0'::uuid
      AND worker.lifecycle_operation_id = v_lifecycle_operation_id
      AND worker.session_storage = 'postgres'
      AND worker.deleted_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'worker lifecycle changed during whatsapp session rollback'
        USING ERRCODE = '40001';
    END IF;
  END IF;

  UPDATE public.whatsapp_session_handoff
  SET state = 'failed',
      error_code = v_error_code,
      updated_at = clock_timestamp(),
      completed_at = clock_timestamp()
  WHERE session_id = p_session_id
    AND source_revision_id = p_previous_revision_id
    AND target_revision_id = p_candidate_revision_id
    AND state IN (
      'requested', 'draining', 'transforming', 'hydrating',
      'validating', 'promoting'
    );
  IF NOT FOUND THEN
    RAISE EXCEPTION 'whatsapp session rollback handoff changed'
      USING ERRCODE = '40001';
  END IF;
  RETURN true;
END;
$function$;

-- Keep the deployed eight-argument ABI callable while old runtime images
-- drain. They persist an explicit generic cause through the same core path.
CREATE OR REPLACE FUNCTION public.rollback_whatsapp_session_revision(
  p_session_id uuid,
  p_candidate_revision_id bigint,
  p_previous_revision_id bigint,
  p_owner_id uuid,
  p_fencing_token bigint,
  p_generation integer,
  p_epoch uuid,
  p_capability text
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT public.rollback_whatsapp_session_revision(
    p_session_id,
    p_candidate_revision_id,
    p_previous_revision_id,
    p_owner_id,
    p_fencing_token,
    p_generation,
    p_epoch,
    p_capability,
    'handoff_validation_failed'
  );
$function$;

REVOKE ALL ON FUNCTION public.rollback_whatsapp_session_revision(
  uuid, bigint, bigint, uuid, bigint, integer, uuid, text, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rollback_whatsapp_session_revision(
  uuid, bigint, bigint, uuid, bigint, integer, uuid, text
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.rollback_whatsapp_session_revision(
  uuid, bigint, bigint, uuid, bigint, integer, uuid, text, text
) TO whatsapp_session_runtime;
GRANT EXECUTE ON FUNCTION public.rollback_whatsapp_session_revision(
  uuid, bigint, bigint, uuid, bigint, integer, uuid, text
) TO whatsapp_session_runtime;
