-- Release a secure-import candidate's companion reservation only when the
-- common rollback has restored the original, unauthenticated pairing draft.
-- The original empty-session branch is retained for explicit disconnects.

CREATE OR REPLACE FUNCTION public.release_empty_whatsapp_companion_v17()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF NEW.state = 'empty'
    AND NEW.active_revision_id IS NULL
    AND NEW.previous_revision_id IS NULL
  THEN
    DELETE FROM public.whatsapp_companion_reservation
    WHERE session_id = NEW.session_id;
    RETURN NEW;
  END IF;

  -- rollback_whatsapp_session_revision marks the rejected target failed,
  -- restores the source header, and only then marks the handoff failed. This
  -- AFTER trigger therefore observes the exact in-transaction rollback
  -- boundary while the matching handoff is still active.
  IF OLD.state = 'handoff'
    AND NEW.state = 'preparing'
    AND OLD.provider IS NOT DISTINCT FROM NEW.provider
    AND OLD.generation IS NOT DISTINCT FROM NEW.generation
    AND OLD.epoch IS NOT DISTINCT FROM NEW.epoch
    AND OLD.capability_hash IS NOT DISTINCT FROM NEW.capability_hash
    AND OLD.active_revision_id IS NOT NULL
    AND OLD.active_revision_id IS NOT DISTINCT FROM NEW.active_revision_id
    AND OLD.previous_revision_id IS NULL
    AND NEW.previous_revision_id IS NULL
    AND OLD.active_device_fingerprint IS NULL
    AND OLD.active_device_fingerprint_version IS NULL
    AND NEW.active_device_fingerprint IS NULL
    AND NEW.active_device_fingerprint_version IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.whatsapp_session_revision AS source_revision
      WHERE source_revision.session_id = NEW.session_id
        AND source_revision.revision_id = NEW.active_revision_id
        AND source_revision.provider = NEW.provider
        AND source_revision.source = 'pairing'
        AND source_revision.status IN ('staging', 'validating')
        AND source_revision.writer_generation = NEW.generation
        AND source_revision.writer_epoch = NEW.epoch
        AND source_revision.capability_hash = NEW.capability_hash
        -- Local bootstrap keys may exist before pairing. Linked-companion
        -- identity, account proof, or a fingerprint may not.
        AND NOT EXISTS (
          SELECT 1
          FROM public.whatsapp_device AS source_device
          WHERE source_device.session_id = source_revision.session_id
            AND source_device.revision_id = source_revision.revision_id
            AND (
              source_device.jid IS NOT NULL
              OR source_device.lid IS NOT NULL
              OR source_device.facebook_uuid IS NOT NULL
              OR source_device.adv_details IS NOT NULL
              OR source_device.adv_account_sig IS NOT NULL
              OR source_device.adv_account_sig_key IS NOT NULL
              OR source_device.adv_device_sig IS NOT NULL
              OR source_device.device_fingerprint IS NOT NULL
              OR source_device.fingerprint_version IS NOT NULL
            )
        )
    )
  THEN
    DELETE FROM public.whatsapp_companion_reservation AS reservation
    WHERE reservation.session_id = NEW.session_id
      AND EXISTS (
        SELECT 1
        FROM public.whatsapp_session_handoff AS handoff
        JOIN public.whatsapp_session_revision AS target_revision
          ON target_revision.session_id = handoff.session_id
         AND target_revision.revision_id = handoff.target_revision_id
         AND target_revision.provider = handoff.target_provider
        JOIN public.whatsapp_device AS target_device
          ON target_device.session_id = target_revision.session_id
         AND target_device.revision_id = target_revision.revision_id
        WHERE handoff.session_id = NEW.session_id
          AND handoff.source_revision_id = NEW.active_revision_id
          AND handoff.source_provider = NEW.provider
          AND handoff.target_provider = NEW.provider
          AND handoff.lifecycle_operation_id IS NULL
          AND handoff.state IN (
            'requested', 'draining', 'transforming', 'hydrating',
            'validating', 'promoting'
          )
          AND target_revision.source = 'secure_import'
          AND target_revision.status = 'failed'
          AND target_revision.error_code IS NOT NULL
          AND target_revision.retired_at IS NOT NULL
          AND target_device.device_fingerprint IS NOT NULL
          AND target_device.fingerprint_version =
            'underchat-whatsapp-device-fingerprint-v2'
          AND reservation.device_fingerprint =
            target_device.device_fingerprint
          AND reservation.fingerprint_version =
            target_device.fingerprint_version
      );
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.release_empty_whatsapp_companion_v17()
FROM PUBLIC;

-- Existing failed imports predate the trigger fix. Release only the rejected
-- target's exact reservation when the durable, completed rollback graph still
-- proves the same empty source invariant. This DELETE is intentionally
-- idempotent and cannot match a ready source or a cross-provider handoff.
DELETE FROM public.whatsapp_companion_reservation AS reservation
USING public.whatsapp_session AS session,
      public.whatsapp_session_revision AS source_revision,
      public.whatsapp_session_handoff AS handoff,
      public.whatsapp_session_revision AS target_revision,
      public.whatsapp_device AS target_device
WHERE session.session_id = reservation.session_id
  AND session.state = 'preparing'
  AND session.active_revision_id IS NOT NULL
  AND session.previous_revision_id IS NULL
  AND session.active_device_fingerprint IS NULL
  AND session.active_device_fingerprint_version IS NULL
  AND source_revision.session_id = session.session_id
  AND source_revision.revision_id = session.active_revision_id
  AND source_revision.provider = session.provider
  AND source_revision.source = 'pairing'
  AND source_revision.status IN ('staging', 'validating')
  AND source_revision.writer_generation = session.generation
  AND source_revision.writer_epoch = session.epoch
  AND source_revision.capability_hash = session.capability_hash
  AND NOT EXISTS (
    SELECT 1
    FROM public.whatsapp_device AS source_device
    WHERE source_device.session_id = source_revision.session_id
      AND source_device.revision_id = source_revision.revision_id
      AND (
        source_device.jid IS NOT NULL
        OR source_device.lid IS NOT NULL
        OR source_device.facebook_uuid IS NOT NULL
        OR source_device.adv_details IS NOT NULL
        OR source_device.adv_account_sig IS NOT NULL
        OR source_device.adv_account_sig_key IS NOT NULL
        OR source_device.adv_device_sig IS NOT NULL
        OR source_device.device_fingerprint IS NOT NULL
        OR source_device.fingerprint_version IS NOT NULL
      )
  )
  AND handoff.session_id = session.session_id
  AND handoff.source_revision_id = source_revision.revision_id
  AND handoff.source_provider = session.provider
  AND handoff.target_provider = session.provider
  AND handoff.lifecycle_operation_id IS NULL
  AND handoff.state = 'failed'
  AND handoff.error_code IS NOT NULL
  AND handoff.completed_at IS NOT NULL
  AND target_revision.session_id = handoff.session_id
  AND target_revision.revision_id = handoff.target_revision_id
  AND target_revision.provider = handoff.target_provider
  AND target_revision.source = 'secure_import'
  AND target_revision.status = 'failed'
  AND target_revision.error_code = handoff.error_code
  AND target_revision.retired_at IS NOT NULL
  AND target_device.session_id = target_revision.session_id
  AND target_device.revision_id = target_revision.revision_id
  AND target_device.device_fingerprint IS NOT NULL
  AND target_device.fingerprint_version =
    'underchat-whatsapp-device-fingerprint-v2'
  AND reservation.device_fingerprint = target_device.device_fingerprint
  AND reservation.fingerprint_version = target_device.fingerprint_version;

-- Preserve the cumulative v17 promotion primitive and narrow its source
-- identity exception to the pristine WWebJS pairing draft used by an
-- extension secure import. All authenticated sources retain exact JID and
-- fingerprint equality.
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
  v_source_is_empty_pairing boolean := false;
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
    AND v_source_provider = 'wwebjs'
    AND v_target_provider = 'wwebjs'
    AND v_target_source = 'secure_import'
    AND v_lifecycle_operation_id IS NULL
  THEN
    -- Extension imports may originate from the one pristine WWebJS pairing
    -- draft. Re-prove that exception at the promotion boundary; an
    -- authenticated or partially populated source must still match identity.
    SELECT EXISTS (
      SELECT 1
      FROM public.whatsapp_session AS session
      JOIN public.whatsapp_session_handoff AS handoff
        ON handoff.session_id = session.session_id
       AND handoff.source_revision_id = p_expected_active_revision_id
       AND handoff.target_revision_id = p_target_revision_id
      JOIN public.whatsapp_session_revision AS source_revision
        ON source_revision.session_id = handoff.session_id
       AND source_revision.revision_id = handoff.source_revision_id
      WHERE session.session_id = p_session_id
        AND session.provider = 'wwebjs'
        AND session.state = 'handoff'
        AND session.active_revision_id = p_expected_active_revision_id
        AND session.previous_revision_id IS NULL
        AND session.active_device_fingerprint IS NULL
        AND session.active_device_fingerprint_version IS NULL
        AND session.generation = p_generation
        AND session.epoch = p_epoch
        AND source_revision.provider = 'wwebjs'
        AND source_revision.source = 'pairing'
        AND source_revision.status IN ('staging', 'validating')
        AND source_revision.writer_generation = session.generation
        AND source_revision.writer_epoch = session.epoch
        AND source_revision.capability_hash = session.capability_hash
        AND handoff.source_provider = 'wwebjs'
        AND handoff.target_provider = 'wwebjs'
        AND handoff.lifecycle_operation_id IS NULL
        AND handoff.state IN (
          'transforming', 'hydrating', 'validating', 'promoting'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM public.whatsapp_device AS state
          WHERE state.session_id = source_revision.session_id
            AND state.revision_id = source_revision.revision_id
        )
        AND NOT EXISTS (
          SELECT 1
          FROM public.whatsapp_artifact AS state
          WHERE state.session_id = source_revision.session_id
            AND state.revision_id = source_revision.revision_id
        )
        AND NOT EXISTS (
          SELECT 1
          FROM public.whatsapp_provider_record AS state
          WHERE state.session_id = source_revision.session_id
            AND state.revision_id = source_revision.revision_id
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.whatsapp_identity_keys AS state
          WHERE state.session_id = source_revision.session_id
            AND state.revision_id = source_revision.revision_id
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.whatsapp_pre_keys AS state
          WHERE state.session_id = source_revision.session_id
            AND state.revision_id = source_revision.revision_id
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.whatsapp_pq_pre_keys AS state
          WHERE state.session_id = source_revision.session_id
            AND state.revision_id = source_revision.revision_id
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.whatsapp_pq_pre_key_state AS state
          WHERE state.session_id = source_revision.session_id
            AND state.revision_id = source_revision.revision_id
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.whatsapp_signal_sessions AS state
          WHERE state.session_id = source_revision.session_id
            AND state.revision_id = source_revision.revision_id
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.whatsapp_sender_keys AS state
          WHERE state.session_id = source_revision.session_id
            AND state.revision_id = source_revision.revision_id
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.whatsapp_app_state_sync_keys AS state
          WHERE state.session_id = source_revision.session_id
            AND state.revision_id = source_revision.revision_id
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.whatsapp_app_state_version AS state
          WHERE state.session_id = source_revision.session_id
            AND state.revision_id = source_revision.revision_id
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.whatsapp_app_state_mutation_macs AS state
          WHERE state.session_id = source_revision.session_id
            AND state.revision_id = source_revision.revision_id
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.whatsapp_contacts AS state
          WHERE state.session_id = source_revision.session_id
            AND state.revision_id = source_revision.revision_id
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.whatsapp_chat_settings AS state
          WHERE state.session_id = source_revision.session_id
            AND state.revision_id = source_revision.revision_id
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.whatsapp_message_secrets AS state
          WHERE state.session_id = source_revision.session_id
            AND state.revision_id = source_revision.revision_id
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.whatsapp_privacy_tokens AS state
          WHERE state.session_id = source_revision.session_id
            AND state.revision_id = source_revision.revision_id
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.whatsapp_nct_salt AS state
          WHERE state.session_id = source_revision.session_id
            AND state.revision_id = source_revision.revision_id
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.whatsapp_lid_map AS state
          WHERE state.session_id = source_revision.session_id
            AND state.revision_id = source_revision.revision_id
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.whatsapp_event_buffer AS state
          WHERE state.session_id = source_revision.session_id
            AND state.revision_id = source_revision.revision_id
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.whatsapp_retry_buffer AS state
          WHERE state.session_id = source_revision.session_id
            AND state.revision_id = source_revision.revision_id
        )
    ) INTO v_source_is_empty_pairing;
  END IF;

  IF NOT v_source_is_empty_pairing
    AND (
      v_source_jid IS NULL
      OR v_source_fingerprint IS NULL
      OR public.normalize_whatsapp_companion_jid(v_device_jid)
        IS DISTINCT FROM public.normalize_whatsapp_companion_jid(v_source_jid)
      OR v_device_fingerprint IS DISTINCT FROM v_source_fingerprint
    )
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

REVOKE ALL ON FUNCTION public.promote_whatsapp_session_revision_v17_impl(
  uuid, bigint, bigint, uuid, bigint, integer, uuid, text, text
) FROM PUBLIC, whatsapp_session_runtime;
