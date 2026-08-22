-- Keep every WWebJS lifecycle CAS on the same explicit profile-anchor ABI
-- used by ordinary store mutations. The v17 functions intentionally acquire
-- worker -> lease -> session/revision locks; only the boundary call changes.
-- Legacy seven-argument mutation callers remain fail-closed after authority
-- adoption, preserving the rolling-version fence introduced in 20260809100000.

CREATE OR REPLACE FUNCTION public.commit_whatsapp_session_activation(p_session_id uuid, p_expected_active_revision_id bigint, p_target_revision_id bigint, p_owner_id uuid, p_fencing_token bigint, p_generation integer, p_epoch uuid, p_capability text, p_expected_jid text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_activation_marker jsonb;
  v_pre_activation_artifact_id uuid;
  v_boundary timestamptz;
BEGIN
  IF p_expected_active_revision_id IS NULL
    OR p_target_revision_id IS NULL
    OR p_expected_active_revision_id = p_target_revision_id
  THEN
    RAISE EXCEPTION 'invalid WWebJS activation revisions'
      USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('app.whatsapp_session_id', p_session_id::text, true);
  -- Preserve the global lifecycle lock order used by promotion/rollback.
  PERFORM 1
  FROM public.worker AS worker
  WHERE worker.worker_id = p_session_id
    AND worker.session_storage = 'postgres'
    AND worker.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'whatsapp worker is unavailable for WWebJS activation'
      USING ERRCODE = '55000';
  END IF;

  PERFORM public.begin_whatsapp_session_mutation(
    p_session_id, p_target_revision_id, p_owner_id, p_fencing_token,
    p_generation, p_epoch, p_capability,
    'profile-anchor-canonical-checkpoint-v1'
  );

  -- Idempotent retry after finalization (for example, a lost SQL response).
  IF EXISTS (
    SELECT 1
    FROM public.whatsapp_session AS session
    JOIN public.whatsapp_session_handoff AS handoff
      ON handoff.session_id = session.session_id
     AND handoff.source_revision_id = p_expected_active_revision_id
     AND handoff.target_revision_id = p_target_revision_id
    WHERE session.session_id = p_session_id
      AND session.provider = 'wwebjs'
      AND session.active_revision_id = p_target_revision_id
      AND session.previous_revision_id = p_expected_active_revision_id
      AND session.state = 'ready'
      AND handoff.target_provider = 'wwebjs'
      AND handoff.state = 'completed'
      AND handoff.point_of_no_return_at IS NOT NULL
      AND handoff.pre_activation_artifact_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.whatsapp_provider_record AS marker
        WHERE marker.session_id = p_session_id
          AND marker.revision_id = p_target_revision_id
          AND marker.namespace = '_wwebjs_lifecycle'
          AND marker.record_key = 'pending_canonical_activation_v1'
      )
  ) THEN
    RETURN true;
  END IF;

  -- Idempotent retry while activation is deliberately incomplete.
  IF EXISTS (
    SELECT 1
    FROM public.whatsapp_session AS session
    JOIN public.whatsapp_session_handoff AS handoff
      ON handoff.session_id = session.session_id
     AND handoff.source_revision_id = p_expected_active_revision_id
     AND handoff.target_revision_id = p_target_revision_id
    WHERE session.session_id = p_session_id
      AND session.provider = 'wwebjs'
      AND session.active_revision_id = p_target_revision_id
      AND session.previous_revision_id = p_expected_active_revision_id
      AND session.state = 'preparing'
      AND handoff.target_provider = 'wwebjs'
      AND handoff.state = 'activating'
      AND handoff.point_of_no_return_at IS NOT NULL
      AND handoff.pre_activation_artifact_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.whatsapp_provider_record AS marker
        WHERE marker.session_id = p_session_id
          AND marker.revision_id = p_target_revision_id
          AND marker.namespace = '_wwebjs_lifecycle'
          AND marker.record_key = 'pending_canonical_activation_v1'
          AND marker.codec_version = 1
      )
  ) THEN
    RETURN true;
  END IF;

  PERFORM 1
  FROM public.whatsapp_session AS session
  JOIN public.whatsapp_session_handoff AS handoff
    ON handoff.session_id = session.session_id
   AND handoff.source_revision_id = p_expected_active_revision_id
   AND handoff.target_revision_id = p_target_revision_id
  JOIN public.whatsapp_session_revision AS target_revision
    ON target_revision.session_id = handoff.session_id
   AND target_revision.revision_id = handoff.target_revision_id
  WHERE session.session_id = p_session_id
    AND session.active_revision_id = p_expected_active_revision_id
    AND session.provider = handoff.source_provider
    AND session.state = 'handoff'
    AND handoff.target_provider = 'wwebjs'
    AND handoff.state IN ('transforming', 'hydrating', 'validating', 'promoting')
    AND target_revision.provider = 'wwebjs'
    AND target_revision.status IN ('staging', 'validating')
  FOR UPDATE OF handoff;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WWebJS activation lineage changed before commit'
      USING ERRCODE = '40001';
  END IF;

  SELECT convert_from(marker.payload, 'UTF8')::jsonb
  INTO v_activation_marker
  FROM public.whatsapp_provider_record AS marker
  WHERE marker.session_id = p_session_id
    AND marker.revision_id = p_target_revision_id
    AND marker.namespace = '_wwebjs_lifecycle'
    AND marker.record_key = 'pending_canonical_activation_v1'
    AND marker.codec_version = 1
  FOR UPDATE;
  IF NOT FOUND
    OR jsonb_typeof(v_activation_marker) IS DISTINCT FROM 'object'
    OR (v_activation_marker ->> 'version') IS DISTINCT FROM '1'
    OR jsonb_typeof(
      v_activation_marker -> 'app_state_hydration_required'
    ) IS DISTINCT FROM 'boolean'
    OR jsonb_typeof(
      v_activation_marker -> 'pq_bootstrap_required'
    ) IS DISTINCT FROM 'boolean'
    OR jsonb_typeof(
      v_activation_marker -> 'ready_checkpoint_artifact_id'
    ) IS DISTINCT FROM 'null'
    OR jsonb_typeof(
      v_activation_marker -> 'ready_checkpoint_checksum_sha256'
    ) IS DISTINCT FROM 'null'
  THEN
    RAISE EXCEPTION 'WWebJS canonical activation marker is missing or invalid'
      USING ERRCODE = '23514';
  END IF;

  SELECT artifact.artifact_id
  INTO v_pre_activation_artifact_id
  FROM public.whatsapp_artifact AS artifact
  JOIN public.whatsapp_session_revision AS revision
    ON revision.session_id = artifact.session_id
   AND revision.revision_id = artifact.revision_id
   AND revision.checksum_sha256 = artifact.checksum_sha256
  WHERE artifact.session_id = p_session_id
    AND artifact.revision_id = p_target_revision_id
    AND artifact.provider = 'wwebjs'
    AND artifact.kind = 'wwebjs_profile'
    AND artifact.status = 'ready'
  ORDER BY artifact.persisted_at DESC, artifact.artifact_id
  LIMIT 1
  FOR SHARE OF artifact;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WWebJS offline activation artifact is unavailable'
      USING ERRCODE = '23514';
  END IF;

  -- The private primitive performs identity/fingerprint verification and the
  -- atomic provider/revision/worker CAS. It temporarily reaches ready/completed
  -- inside this transaction; the following writes replace those states before
  -- anything becomes externally visible.
  PERFORM public.promote_whatsapp_session_revision_v17_impl(
    p_session_id, p_expected_active_revision_id, p_target_revision_id,
    p_owner_id, p_fencing_token, p_generation, p_epoch, p_capability,
    p_expected_jid
  );

  v_boundary := clock_timestamp();
  UPDATE public.whatsapp_session
  SET state = 'preparing',
      last_error_at = NULL,
      updated_at = v_boundary
  WHERE session_id = p_session_id
    AND provider = 'wwebjs'
    AND active_revision_id = p_target_revision_id
    AND previous_revision_id = p_expected_active_revision_id
    AND state = 'ready'
    AND generation = p_generation
    AND epoch = p_epoch;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WWebJS session header changed at activation commit'
      USING ERRCODE = '40001';
  END IF;

  UPDATE public.whatsapp_session_handoff
  SET state = 'activating',
      point_of_no_return_at = v_boundary,
      pre_activation_artifact_id = v_pre_activation_artifact_id,
      updated_at = v_boundary,
      completed_at = NULL
  WHERE session_id = p_session_id
    AND source_revision_id = p_expected_active_revision_id
    AND target_revision_id = p_target_revision_id
    AND target_provider = 'wwebjs'
    AND state = 'completed';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WWebJS activation lineage changed at commit'
      USING ERRCODE = '40001';
  END IF;
  RETURN true;
END;
$function$;


CREATE OR REPLACE FUNCTION public.finalize_whatsapp_session_activation(p_session_id uuid, p_target_revision_id bigint, p_owner_id uuid, p_fencing_token bigint, p_generation integer, p_epoch uuid, p_capability text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_activation_marker jsonb;
  v_point_of_no_return_at timestamptz;
  v_pre_activation_artifact_id uuid;
  v_target_checksum text;
  v_ready_checkpoint_artifact_id uuid;
  v_ready_checkpoint_checksum text;
BEGIN
  IF p_target_revision_id IS NULL THEN
    RAISE EXCEPTION 'invalid WWebJS activation finalization revision'
      USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('app.whatsapp_session_id', p_session_id::text, true);
  PERFORM 1
  FROM public.worker AS worker
  WHERE worker.worker_id = p_session_id
    AND worker.worker_type_id =
      '019a930d-c6f6-766d-9c84-62b9c3e7d1f0'::uuid
    AND worker.session_storage = 'postgres'
    AND worker.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WWebJS worker is unavailable for activation finalization'
      USING ERRCODE = '55000';
  END IF;

  PERFORM public.begin_whatsapp_session_mutation(
    p_session_id, p_target_revision_id, p_owner_id, p_fencing_token,
    p_generation, p_epoch, p_capability,
    'profile-anchor-canonical-checkpoint-v1'
  );

  IF EXISTS (
    SELECT 1
    FROM public.whatsapp_session AS session
    JOIN public.whatsapp_session_handoff AS handoff
      ON handoff.session_id = session.session_id
     AND handoff.target_revision_id = p_target_revision_id
    WHERE session.session_id = p_session_id
      AND session.provider = 'wwebjs'
      AND session.active_revision_id = p_target_revision_id
      AND session.state = 'ready'
      AND handoff.target_provider = 'wwebjs'
      AND handoff.state = 'completed'
      AND handoff.point_of_no_return_at IS NOT NULL
      AND handoff.pre_activation_artifact_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.whatsapp_provider_record AS marker
        WHERE marker.session_id = p_session_id
          AND marker.revision_id = p_target_revision_id
          AND marker.namespace = '_wwebjs_lifecycle'
          AND marker.record_key = 'pending_canonical_activation_v1'
      )
  ) THEN
    RETURN true;
  END IF;

  SELECT handoff.point_of_no_return_at,
         handoff.pre_activation_artifact_id,
         target_revision.checksum_sha256
  INTO v_point_of_no_return_at, v_pre_activation_artifact_id,
       v_target_checksum
  FROM public.whatsapp_session AS session
  JOIN public.whatsapp_session_handoff AS handoff
    ON handoff.session_id = session.session_id
   AND handoff.target_revision_id = p_target_revision_id
  JOIN public.whatsapp_session_revision AS source_revision
    ON source_revision.session_id = handoff.session_id
   AND source_revision.revision_id = handoff.source_revision_id
  JOIN public.whatsapp_session_revision AS target_revision
    ON target_revision.session_id = handoff.session_id
   AND target_revision.revision_id = handoff.target_revision_id
  WHERE session.session_id = p_session_id
    AND session.provider = 'wwebjs'
    AND session.active_revision_id = p_target_revision_id
    AND session.previous_revision_id = handoff.source_revision_id
    AND session.state = 'preparing'
    AND session.active_device_fingerprint IS NOT NULL
    AND handoff.target_provider = 'wwebjs'
    AND handoff.state = 'activating'
    AND handoff.point_of_no_return_at IS NOT NULL
    AND handoff.pre_activation_artifact_id IS NOT NULL
    AND source_revision.status = 'retired'
    AND target_revision.provider = 'wwebjs'
    AND target_revision.status = 'active'
    AND target_revision.checksum_sha256 IS NOT NULL
    AND target_revision.persisted_at >= handoff.point_of_no_return_at
    AND session.last_persisted_at >= handoff.point_of_no_return_at
  FOR UPDATE OF handoff;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WWebJS activation is not ready for finalization'
      USING ERRCODE = '55000';
  END IF;

  SELECT convert_from(marker.payload, 'UTF8')::jsonb
  INTO v_activation_marker
  FROM public.whatsapp_provider_record AS marker
  WHERE marker.session_id = p_session_id
    AND marker.revision_id = p_target_revision_id
    AND marker.namespace = '_wwebjs_lifecycle'
    AND marker.record_key = 'pending_canonical_activation_v1'
    AND marker.codec_version = 1
  FOR UPDATE;
  IF NOT FOUND
    OR jsonb_typeof(v_activation_marker) IS DISTINCT FROM 'object'
    OR (v_activation_marker ->> 'version') IS DISTINCT FROM '1'
    OR (v_activation_marker ->> 'app_state_hydration_required')
      IS DISTINCT FROM 'false'
    OR (v_activation_marker ->> 'pq_bootstrap_required')
      IS DISTINCT FROM 'false'
    OR jsonb_typeof(
      v_activation_marker -> 'ready_checkpoint_artifact_id'
    ) IS DISTINCT FROM 'string'
    OR (v_activation_marker ->> 'ready_checkpoint_artifact_id')
      !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    OR jsonb_typeof(
      v_activation_marker -> 'ready_checkpoint_checksum_sha256'
    ) IS DISTINCT FROM 'string'
    OR (v_activation_marker ->> 'ready_checkpoint_checksum_sha256')
      !~ '^[0-9a-f]{64}$'
  THEN
    RAISE EXCEPTION 'WWebJS canonical activation work is incomplete'
      USING ERRCODE = '23514';
  END IF;

  v_ready_checkpoint_artifact_id :=
    (v_activation_marker ->> 'ready_checkpoint_artifact_id')::uuid;
  v_ready_checkpoint_checksum :=
    v_activation_marker ->> 'ready_checkpoint_checksum_sha256';

  PERFORM 1
  FROM public.whatsapp_artifact AS artifact
  WHERE artifact.session_id = p_session_id
    AND artifact.revision_id = p_target_revision_id
    AND artifact.provider = 'wwebjs'
    AND artifact.kind = 'wwebjs_profile'
    AND artifact.status = 'ready'
    AND artifact.artifact_id = v_ready_checkpoint_artifact_id
    AND artifact.artifact_id <> v_pre_activation_artifact_id
    AND artifact.checksum_sha256 = v_ready_checkpoint_checksum
    AND artifact.checksum_sha256 = v_target_checksum
    AND artifact.persisted_at >= v_point_of_no_return_at
  FOR SHARE OF artifact;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WWebJS post-activation stable checkpoint is missing'
      USING ERRCODE = '23514';
  END IF;

  DELETE FROM public.whatsapp_provider_record AS marker
  WHERE marker.session_id = p_session_id
    AND marker.revision_id = p_target_revision_id
    AND marker.namespace = '_wwebjs_lifecycle'
    AND marker.record_key = 'pending_canonical_activation_v1'
    AND marker.codec_version = 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WWebJS canonical activation marker changed'
      USING ERRCODE = '40001';
  END IF;

  UPDATE public.whatsapp_session
  SET state = 'ready',
      last_error_at = NULL,
      updated_at = clock_timestamp()
  WHERE session_id = p_session_id
    AND provider = 'wwebjs'
    AND active_revision_id = p_target_revision_id
    AND state = 'preparing'
    AND generation = p_generation
    AND epoch = p_epoch;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WWebJS session changed during activation finalization'
      USING ERRCODE = '40001';
  END IF;

  UPDATE public.whatsapp_session_handoff
  SET state = 'completed',
      updated_at = clock_timestamp(),
      completed_at = clock_timestamp()
  WHERE session_id = p_session_id
    AND target_revision_id = p_target_revision_id
    AND target_provider = 'wwebjs'
    AND state = 'activating'
    AND point_of_no_return_at = v_point_of_no_return_at
    AND pre_activation_artifact_id = v_pre_activation_artifact_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WWebJS activation lineage changed before completion'
      USING ERRCODE = '40001';
  END IF;
  RETURN true;
END;
$function$;


CREATE OR REPLACE FUNCTION public.finalize_whatsapp_session_pairing(p_session_id uuid, p_revision_id bigint, p_owner_id uuid, p_fencing_token bigint, p_generation integer, p_epoch uuid, p_capability text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_provider text;
  v_device_fingerprint bytea;
  v_device_jid text;
  v_checksum text;
BEGIN
  PERFORM public.begin_whatsapp_session_mutation(
    p_session_id, p_revision_id, p_owner_id, p_fencing_token,
    p_generation, p_epoch, p_capability,
    'profile-anchor-canonical-checkpoint-v1'
  );

  SELECT revision.provider, device.device_fingerprint, device.jid
  INTO v_provider, v_device_fingerprint, v_device_jid
  FROM public.whatsapp_session_revision AS revision
  JOIN public.whatsapp_device AS device
    ON device.session_id = revision.session_id
   AND device.revision_id = revision.revision_id
  WHERE revision.session_id = p_session_id
    AND revision.revision_id = p_revision_id
    AND revision.status IN ('staging', 'validating', 'active')
    AND device.jid IS NOT NULL
    AND device.device_fingerprint IS NOT NULL
    AND (
      (
        revision.provider IN ('baileys', 'whatsmeow')
        AND device.registration_id IS NOT NULL
        AND device.noise_key IS NOT NULL
        AND device.identity_key IS NOT NULL
        AND device.signed_pre_key IS NOT NULL
        AND device.signed_pre_key_sig IS NOT NULL
      )
      OR (
        revision.provider = 'wwebjs'
        AND EXISTS (
          SELECT 1
          FROM public.whatsapp_artifact AS artifact
          WHERE artifact.session_id = revision.session_id
            AND artifact.revision_id = revision.revision_id
            AND artifact.provider = 'wwebjs'
            AND artifact.status = 'ready'
        )
      )
    )
  FOR UPDATE OF revision, device;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'paired whatsapp session identity is incomplete'
      USING ERRCODE = '23514';
  END IF;

  v_checksum := encode(
    public.digest(convert_to(v_device_jid, 'UTF8') || v_device_fingerprint, 'sha256'),
    'hex'
  );
  UPDATE public.whatsapp_session_revision
  SET status = 'active',
      checksum_sha256 = COALESCE(checksum_sha256, v_checksum),
      persisted_at = COALESCE(persisted_at, clock_timestamp()),
      validated_at = COALESCE(validated_at, clock_timestamp()),
      promoted_at = COALESCE(promoted_at, clock_timestamp())
  WHERE session_id = p_session_id
    AND revision_id = p_revision_id;

  UPDATE public.whatsapp_session
  SET state = 'ready',
      active_device_fingerprint = v_device_fingerprint,
      last_persisted_at = clock_timestamp(),
      last_error_at = NULL,
      updated_at = clock_timestamp()
  WHERE session_id = p_session_id
    AND active_revision_id = p_revision_id
    AND provider = v_provider
    AND generation = p_generation
    AND epoch = p_epoch;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'whatsapp session changed during pairing finalization'
      USING ERRCODE = '40001';
  END IF;
  RETURN true;
END;
$function$;


CREATE OR REPLACE FUNCTION public.promote_whatsapp_session_revision_v17_impl(p_session_id uuid, p_expected_active_revision_id bigint, p_target_revision_id bigint, p_owner_id uuid, p_fencing_token bigint, p_generation integer, p_epoch uuid, p_capability text, p_expected_jid text DEFAULT NULL::text)
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
  v_device_fingerprint bytea;
  v_device_jid text;
  v_source_fingerprint bytea;
  v_source_jid text;
BEGIN
  PERFORM set_config('app.whatsapp_session_id', p_session_id::text, true);
  -- Worker remains source-authoritative until this transaction commits. Lock
  -- it before the session graph to keep the control-plane lock order stable.
  PERFORM 1
  FROM public.worker AS worker
  WHERE worker.worker_id = p_session_id
    AND worker.session_storage = 'postgres'
    AND worker.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'whatsapp worker is unavailable for promotion'
      USING ERRCODE = '55000';
  END IF;

  PERFORM public.begin_whatsapp_session_mutation(
    p_session_id,
    p_target_revision_id,
    p_owner_id,
    p_fencing_token,
    p_generation,
    p_epoch,
    p_capability,
    'profile-anchor-canonical-checkpoint-v1'
  );

  -- Serialize the exact handoff before touching either revision. This closes
  -- the race where another connection could fail/rollback the handoff after
  -- the lease check but before the header promotion.
  -- Idempotent retry after a committed promotion whose response was lost.
  IF EXISTS (
    SELECT 1
    FROM public.whatsapp_session AS session
    JOIN public.whatsapp_session_handoff AS handoff
      ON handoff.session_id = session.session_id
     AND handoff.source_revision_id = p_expected_active_revision_id
     AND handoff.target_revision_id = p_target_revision_id
    JOIN public.worker AS worker
      ON worker.worker_id = session.session_id
    WHERE session.session_id = p_session_id
      AND session.active_revision_id = p_target_revision_id
      AND session.provider = handoff.target_provider
      AND session.state = 'ready'
      AND handoff.state = 'completed'
      AND worker.worker_type_id = CASE handoff.target_provider
        WHEN 'baileys' THEN '019a930d-c6f6-766d-9c84-53307d4159a1'::uuid
        WHEN 'wwebjs' THEN '019a930d-c6f6-766d-9c84-62b9c3e7d1f0'::uuid
        WHEN 'whatsmeow' THEN 'e80ad183-2b46-4628-9105-a036f2d28720'::uuid
      END
  ) THEN
    RETURN true;
  END IF;

  SELECT handoff.source_provider, target_revision.provider,
    target_revision.source, handoff.lifecycle_operation_id
  INTO v_source_provider, v_target_provider, v_target_source,
    v_lifecycle_operation_id
  FROM public.whatsapp_session AS session
  JOIN public.whatsapp_session_handoff AS handoff
    ON handoff.session_id = session.session_id
   AND handoff.source_revision_id = p_expected_active_revision_id
   AND handoff.target_revision_id = p_target_revision_id
  JOIN public.whatsapp_session_revision AS source_revision
    ON source_revision.session_id = handoff.session_id
   AND source_revision.revision_id = handoff.source_revision_id
  JOIN public.whatsapp_session_revision AS target_revision
    ON target_revision.session_id = handoff.session_id
   AND target_revision.revision_id = handoff.target_revision_id
  WHERE session.session_id = p_session_id
    AND session.active_revision_id = p_expected_active_revision_id
    AND session.provider = handoff.source_provider
    AND source_revision.provider = handoff.source_provider
    AND target_revision.provider = handoff.target_provider
    AND handoff.state IN (
      'transforming', 'hydrating', 'validating', 'promoting'
    )
  FOR UPDATE OF handoff;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'whatsapp session promotion handoff changed'
      USING ERRCODE = '40001';
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

  SELECT revision.provider, device.device_fingerprint, device.jid
  INTO v_target_provider, v_device_fingerprint, v_device_jid
  FROM public.whatsapp_session_revision AS revision
  JOIN public.whatsapp_device AS device
    ON device.session_id = revision.session_id
   AND device.revision_id = revision.revision_id
  WHERE revision.session_id = p_session_id
    AND revision.revision_id = p_target_revision_id
    AND revision.provider = v_target_provider
    AND revision.status IN ('staging', 'validating')
    AND revision.checksum_sha256 IS NOT NULL
    AND device.jid IS NOT NULL
    AND device.device_fingerprint IS NOT NULL
    AND (
      (
        revision.provider IN ('baileys', 'whatsmeow')
        AND device.registration_id IS NOT NULL
        AND device.noise_key IS NOT NULL
        AND device.identity_key IS NOT NULL
        AND device.signed_pre_key IS NOT NULL
        AND device.signed_pre_key_sig IS NOT NULL
      )
      OR (
        revision.provider = 'wwebjs'
        AND EXISTS (
          SELECT 1
          FROM public.whatsapp_artifact AS artifact
          WHERE artifact.session_id = revision.session_id
            AND artifact.revision_id = revision.revision_id
            AND artifact.provider = 'wwebjs'
            AND artifact.status = 'ready'
        )
      )
    )
  FOR UPDATE OF revision, device;

  IF NOT FOUND OR (
    p_expected_jid IS NOT NULL
    AND public.normalize_whatsapp_companion_jid(v_device_jid)
      <> public.normalize_whatsapp_companion_jid(p_expected_jid)
  ) THEN
    RAISE EXCEPTION 'candidate whatsapp session identity is incomplete or mismatched'
      USING ERRCODE = '23514';
  END IF;

  SELECT source_device.device_fingerprint, source_device.jid
  INTO v_source_fingerprint, v_source_jid
  FROM public.whatsapp_session AS session
  JOIN public.whatsapp_session_revision AS source_revision
    ON source_revision.session_id = session.session_id
   AND source_revision.revision_id = session.active_revision_id
  JOIN public.whatsapp_device AS source_device
    ON source_device.session_id = source_revision.session_id
   AND source_device.revision_id = source_revision.revision_id
  WHERE session.session_id = p_session_id
    AND session.active_revision_id = p_expected_active_revision_id
    AND source_revision.status IN ('staging', 'validating', 'active')
    AND source_device.jid IS NOT NULL
    AND source_device.device_fingerprint IS NOT NULL
  FOR SHARE OF source_revision, source_device;
  IF NOT FOUND
    OR public.normalize_whatsapp_companion_jid(v_device_jid)
      IS DISTINCT FROM public.normalize_whatsapp_companion_jid(v_source_jid)
    OR v_device_fingerprint IS DISTINCT FROM v_source_fingerprint
  THEN
    RAISE EXCEPTION 'candidate whatsapp session changed companion identity'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.whatsapp_session_revision
  SET status = 'retired', retired_at = clock_timestamp()
  WHERE session_id = p_session_id
    AND revision_id = p_expected_active_revision_id
    AND status IN ('staging', 'validating', 'active');

  IF p_expected_active_revision_id IS NOT NULL AND NOT FOUND THEN
    RAISE EXCEPTION 'active whatsapp session revision changed during promotion'
      USING ERRCODE = '40001';
  END IF;

  UPDATE public.whatsapp_session_revision
  SET status = 'active',
      validated_at = COALESCE(validated_at, clock_timestamp()),
      promoted_at = clock_timestamp()
  WHERE session_id = p_session_id
    AND revision_id = p_target_revision_id
    AND status IN ('staging', 'validating');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'candidate whatsapp session revision is no longer promotable'
      USING ERRCODE = '40001';
  END IF;

  UPDATE public.whatsapp_session
  SET provider = v_target_provider,
      state = 'ready',
      previous_revision_id = p_expected_active_revision_id,
      active_revision_id = p_target_revision_id,
      active_device_fingerprint = v_device_fingerprint,
      last_persisted_at = clock_timestamp(),
      updated_at = clock_timestamp()
  WHERE session_id = p_session_id
    AND active_revision_id IS NOT DISTINCT FROM p_expected_active_revision_id
    AND generation = p_generation
    AND epoch = p_epoch;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'whatsapp session header changed during promotion'
      USING ERRCODE = '40001';
  END IF;

  IF v_source_provider = v_target_provider
    AND v_target_source = 'secure_import'
    AND v_lifecycle_operation_id IS NULL
  THEN
    -- Same-provider secure import replaces only the canonical projection. It
    -- is not a channel-type lifecycle operation and must not require or
    -- mutate worker lifecycle metadata. The worker row is already locked;
    -- revalidate that its provider type and PostgreSQL ownership stayed put.
    PERFORM 1
    FROM public.worker AS worker
    WHERE worker.worker_id = p_session_id
      AND worker.worker_type_id = v_source_worker_type
      AND worker.session_storage = 'postgres'
      AND worker.deleted_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'worker provider changed during whatsapp secure import promotion'
        USING ERRCODE = '40001';
    END IF;
  ELSE
    UPDATE public.worker AS worker
    SET worker_type_id = v_target_worker_type,
        updated_at = clock_timestamp()
    WHERE worker.worker_id = p_session_id
      AND worker.worker_type_id = v_source_worker_type
      AND worker.worker_status_id = '019a930d-c6f6-766d-9c84-46093814d8e0'::uuid
      AND worker.lifecycle_operation_id = v_lifecycle_operation_id
      AND worker.session_storage = 'postgres'
      AND worker.deleted_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'worker provider changed during whatsapp session promotion'
        USING ERRCODE = '40001';
    END IF;
  END IF;

  UPDATE public.whatsapp_session_handoff
  SET state = 'completed', updated_at = clock_timestamp(), completed_at = clock_timestamp()
  WHERE session_id = p_session_id
    AND source_revision_id = p_expected_active_revision_id
    AND target_revision_id = p_target_revision_id
    AND source_provider = (
      SELECT source_revision.provider
      FROM public.whatsapp_session_revision AS source_revision
      WHERE source_revision.session_id = p_session_id
        AND source_revision.revision_id = p_expected_active_revision_id
    )
    AND target_provider = v_target_provider
    AND state IN ('transforming', 'hydrating', 'validating', 'promoting');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'whatsapp session handoff changed before completion'
      USING ERRCODE = '40001';
  END IF;
  RETURN true;
END;
$function$;


CREATE OR REPLACE FUNCTION public.rollback_whatsapp_session_revision(p_session_id uuid, p_candidate_revision_id bigint, p_previous_revision_id bigint, p_owner_id uuid, p_fencing_token bigint, p_generation integer, p_epoch uuid, p_capability text, p_error_code text)
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
    p_capability,
    'profile-anchor-canonical-checkpoint-v1'
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

REVOKE ALL ON FUNCTION public.finalize_whatsapp_session_pairing(
  uuid, bigint, uuid, bigint, integer, uuid, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.commit_whatsapp_session_activation(
  uuid, bigint, bigint, uuid, bigint, integer, uuid, text, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_whatsapp_session_activation(
  uuid, bigint, uuid, bigint, integer, uuid, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.promote_whatsapp_session_revision_v17_impl(
  uuid, bigint, bigint, uuid, bigint, integer, uuid, text, text
) FROM PUBLIC, whatsapp_session_runtime;
REVOKE ALL ON FUNCTION public.rollback_whatsapp_session_revision(
  uuid, bigint, bigint, uuid, bigint, integer, uuid, text, text
) FROM PUBLIC;
