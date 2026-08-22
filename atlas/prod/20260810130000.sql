-- The manager may intentionally reuse the exact Baileys staging revision that
-- is already open in the runtime while starting a new QR pairing attempt. The
-- grant-aware database boundary used by workers still required a completely
-- empty session tree, so it rejected that valid draft after the manager had
-- issued the one-shot grant. Preserve the original strict path for every
-- other state and add a narrowly fenced path for this exact resumable draft.

ALTER FUNCTION public.activate_whatsapp_runtime_fence(
  uuid, uuid, text, integer, uuid, text, text, uuid, uuid
) RENAME TO activate_whatsapp_runtime_fence_pairing_session_base;

REVOKE ALL ON FUNCTION
  public.activate_whatsapp_runtime_fence_pairing_session_base(
    uuid, uuid, text, integer, uuid, text, text, uuid, uuid
  ) FROM PUBLIC;
REVOKE ALL ON FUNCTION
  public.activate_whatsapp_runtime_fence_pairing_session_base(
    uuid, uuid, text, integer, uuid, text, text, uuid, uuid
  ) FROM whatsapp_session_runtime;

CREATE OR REPLACE FUNCTION public.activate_whatsapp_runtime_fence(
  p_worker_id uuid,
  p_account_id uuid,
  p_provider text,
  p_generation integer,
  p_writer_epoch uuid,
  p_capability text,
  p_container_id text,
  p_connection_epoch uuid,
  p_connection_attempt_id uuid
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
  v_worker_status_id uuid;
  v_runtime public.worker_runtime%ROWTYPE;
  v_result record;
  v_resumable_pairing_draft boolean := false;
  v_disconnect_barrier_active boolean := false;
  v_lease_found boolean := false;
  v_lease_released boolean := false;
  v_lease_expired boolean := false;
  v_lease_live boolean := false;
  v_grant_attempt_id uuid;
  v_grant_epoch uuid;
  v_grant_expected_epoch varchar(100);
  v_grant_sequence bigint;
  v_grant_live boolean := false;
  v_grant_completion boolean := false;
BEGIN
  activated := false;
  already_active := false;
  connection_sequence := NULL;

  IF p_worker_id IS NULL
    OR p_account_id IS NULL
    OR p_generation IS NULL
    OR p_generation <= 0
    OR p_writer_epoch IS NULL
    OR p_capability IS NULL
    OR p_container_id IS NULL
    OR p_connection_epoch IS NULL
    OR p_connection_attempt_id IS NULL
  THEN
    RETURN NEXT;
    RETURN;
  END IF;

  -- Keep the established global lock order. The stopped status is checked at
  -- this direct-worker boundary too; the 8-argument compatibility wrapper has
  -- its own stopped fence, but QR workers call this overload directly.
  SELECT owner.worker_status_id
  INTO v_worker_status_id
  FROM public.worker AS owner
  WHERE owner.worker_id = p_worker_id
    AND owner.account_id = p_account_id
    AND owner.deleted_at IS NULL
  FOR SHARE;
  IF NOT FOUND
    OR v_worker_status_id = '019feb94-c2ff-76b1-9d00-d7602a50affe'::uuid
  THEN
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT runtime.*
  INTO v_runtime
  FROM public.worker_runtime AS runtime
  WHERE runtime.worker_id = p_worker_id
    AND runtime.runtime_generation = p_generation
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NEXT;
    RETURN;
  END IF;

  -- Volume-backed runtimes and canonical empty PostgreSQL sessions continue
  -- through the original grant-aware implementation unchanged.
  IF v_runtime.session_storage <> 'postgres'
    OR lower(trim(p_provider)) <> 'baileys'
  THEN
    RETURN QUERY
    SELECT original.activated,
           original.already_active,
           original.connection_sequence
    FROM public.activate_whatsapp_runtime_fence_pairing_session_base(
      p_worker_id,
      p_account_id,
      p_provider,
      p_generation,
      p_writer_epoch,
      p_capability,
      p_container_id,
      p_connection_epoch,
      p_connection_attempt_id
    ) AS original;
    RETURN;
  END IF;

  PERFORM set_config('app.whatsapp_session_id', p_worker_id::text, true);
  SELECT COALESCE((
    session.state = 'preparing'
    AND session.provider = 'baileys'
    AND session.generation = p_generation
    AND session.epoch = p_writer_epoch
    AND session.capability_hash =
      encode(public.digest(p_capability, 'sha256'), 'hex')
    AND session.active_revision_id IS NOT NULL
    AND session.previous_revision_id IS NULL
    AND session.active_device_fingerprint IS NULL
    AND session.active_device_fingerprint_version IS NULL
    AND session.last_error_at IS NULL
    AND (
      SELECT count(*)
      FROM public.whatsapp_session_revision AS revision_count
      WHERE revision_count.session_id = p_worker_id
    ) = 1
    AND NOT EXISTS (
      SELECT 1
      FROM public.whatsapp_companion_reservation AS reservation
      WHERE reservation.session_id = p_worker_id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.whatsapp_session_handoff AS handoff
      WHERE handoff.session_id = p_worker_id
    )
    AND (
      SELECT count(*)
      FROM public.whatsapp_session_gc_queue AS gc_queue
      WHERE gc_queue.session_id = p_worker_id
    ) <= 1
    AND (
      SELECT count(*)
      FROM public.whatsapp_provider_record AS provider_record
      WHERE provider_record.session_id = p_worker_id
    ) <= 1
    AND NOT EXISTS (
      SELECT 1
      FROM public.whatsapp_provider_record AS provider_record
      WHERE provider_record.session_id = p_worker_id
        AND provider_record.namespace <> 'baileys/creds'
    )
    AND (
      SELECT count(*)
      FROM public.whatsapp_device AS device_count
      WHERE device_count.session_id = p_worker_id
    ) <= 1
    AND NOT EXISTS (
      SELECT 1
      FROM public.whatsapp_artifact AS artifact
      WHERE artifact.session_id = p_worker_id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.whatsapp_wwebjs_profile_anchor AS anchor
      WHERE anchor.session_id = p_worker_id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.whatsapp_artifact_chunk AS artifact_chunk
      WHERE artifact_chunk.session_id = p_worker_id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.whatsapp_artifact_blob AS artifact_blob
      WHERE artifact_blob.session_id = p_worker_id
    )
    AND EXISTS (
      SELECT 1
      FROM public.whatsapp_session_revision AS revision
      WHERE revision.session_id = session.session_id
        AND revision.revision_id = session.active_revision_id
        AND revision.provider = 'baileys'
        AND revision.status = 'staging'
        AND revision.source = 'pairing'
        AND revision.writer_generation = p_generation
        AND revision.writer_epoch = p_writer_epoch
        AND revision.capability_hash =
          encode(public.digest(p_capability, 'sha256'), 'hex')
        AND NOT EXISTS (
          SELECT 1
          FROM public.whatsapp_device AS device
          WHERE device.session_id = revision.session_id
            AND device.revision_id = revision.revision_id
            AND (
              device.jid IS NOT NULL
              OR device.device_fingerprint IS NOT NULL
              OR device.registration_id IS NOT NULL
              OR device.noise_key IS NOT NULL
              OR device.identity_key IS NOT NULL
              OR device.signed_pre_key IS NOT NULL
              OR device.signed_pre_key_sig IS NOT NULL
            )
        )
    )
  ), false)
  INTO v_resumable_pairing_draft
  FROM public.whatsapp_session AS session
  WHERE session.session_id = p_worker_id
  FOR SHARE;

  IF NOT v_resumable_pairing_draft THEN
    RETURN QUERY
    SELECT original.activated,
           original.already_active,
           original.connection_sequence
    FROM public.activate_whatsapp_runtime_fence_pairing_session_base(
      p_worker_id,
      p_account_id,
      p_provider,
      p_generation,
      p_writer_epoch,
      p_capability,
      p_container_id,
      p_connection_epoch,
      p_connection_attempt_id
    ) AS original;
    RETURN;
  END IF;

  SELECT
    lease.fencing_token > 0
      AND lease.generation = p_generation
      AND lease.owner_id IS NULL
      AND lease.provider IS NULL
      AND lease.epoch IS NULL
      AND lease.expires_at IS NULL,
    lease.fencing_token > 0
      AND lease.generation = p_generation
      AND lease.owner_id IS NOT NULL
      AND lease.provider = 'baileys'
      AND lease.epoch = p_writer_epoch
      AND lease.expires_at <= clock_timestamp(),
    lease.fencing_token > 0
      AND lease.generation = p_generation
      AND lease.owner_id IS NOT NULL
      AND lease.provider = 'baileys'
      AND lease.epoch = p_writer_epoch
      AND lease.expires_at > clock_timestamp()
  INTO v_lease_released, v_lease_expired, v_lease_live
  FROM public.whatsapp_session_lease AS lease
  WHERE lease.session_id = p_worker_id
  FOR UPDATE;
  v_lease_found := FOUND;

  SELECT pairing_grant.connection_attempt_id,
         pairing_grant.authorized_connection_epoch,
         pairing_grant.expected_connection_epoch,
         pairing_grant.connection_sequence_at_grant,
         pairing_grant.expires_at > clock_timestamp()
  INTO v_grant_attempt_id,
       v_grant_epoch,
       v_grant_expected_epoch,
       v_grant_sequence,
       v_grant_live
  FROM public.whatsapp_pairing_activation_grant AS pairing_grant
  WHERE pairing_grant.worker_id = p_worker_id
    AND pairing_grant.account_id = p_account_id
    AND pairing_grant.provider = 'baileys'
    AND pairing_grant.runtime_generation = p_generation
    AND pairing_grant.container_id = v_runtime.container_id
    AND pairing_grant.consumed_at IS NULL
    AND pairing_grant.revoked_at IS NULL
  FOR UPDATE;

  v_disconnect_barrier_active :=
    v_runtime.connection_disconnected_at IS NOT NULL
    AND v_runtime.connection_epoch IS NOT DISTINCT FROM
      v_runtime.disconnected_connection_epoch;
  v_grant_completion := COALESCE((
    NOT v_disconnect_barrier_active
    AND v_grant_attempt_id = p_connection_attempt_id
    AND v_grant_epoch = p_connection_epoch
    AND v_runtime.connection_epoch = p_connection_epoch::text
    AND v_runtime.source_provider = 'baileys'
    AND v_runtime.connection_sequence = v_grant_sequence + 1
  ), false);

  IF v_grant_completion THEN
    UPDATE public.whatsapp_pairing_activation_grant AS pairing_grant
    SET consumed_at = clock_timestamp()
    WHERE pairing_grant.connection_attempt_id = p_connection_attempt_id
      AND pairing_grant.worker_id = p_worker_id
      AND pairing_grant.account_id = p_account_id
      AND pairing_grant.provider = 'baileys'
      AND pairing_grant.runtime_generation = p_generation
      AND pairing_grant.container_id = v_runtime.container_id
      AND pairing_grant.authorized_connection_epoch = p_connection_epoch
      AND pairing_grant.connection_sequence_at_grant = v_grant_sequence
      AND pairing_grant.consumed_at IS NULL
      AND pairing_grant.revoked_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'whatsapp pairing activation grant changed'
        USING ERRCODE = '40001';
    END IF;

    activated := true;
    already_active := true;
    connection_sequence := v_runtime.connection_sequence;
    RETURN NEXT;
    RETURN;
  END IF;

  IF NOT v_grant_live
    OR v_grant_attempt_id IS DISTINCT FROM p_connection_attempt_id
    OR v_grant_epoch IS DISTINCT FROM p_connection_epoch
    OR v_grant_expected_epoch IS DISTINCT FROM v_runtime.connection_epoch
    OR v_grant_sequence IS DISTINCT FROM v_runtime.connection_sequence
    OR NOT v_lease_found
    OR NOT (
      v_lease_released
      OR v_lease_expired
      OR (NOT v_disconnect_barrier_active AND v_lease_live)
    )
  THEN
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT activation.activated,
         activation.already_active,
         activation.connection_sequence
  INTO v_result
  FROM public.activate_whatsapp_runtime_fence_pairing_grant_base(
    p_worker_id,
    p_account_id,
    p_provider,
    p_generation,
    p_writer_epoch,
    p_capability,
    p_container_id,
    p_connection_epoch
  ) AS activation;

  activated := COALESCE(v_result.activated, false);
  already_active := COALESCE(v_result.already_active, false);
  connection_sequence := v_result.connection_sequence;

  IF activated THEN
    UPDATE public.whatsapp_pairing_activation_grant AS pairing_grant
    SET consumed_at = clock_timestamp()
    WHERE pairing_grant.connection_attempt_id = p_connection_attempt_id
      AND pairing_grant.worker_id = p_worker_id
      AND pairing_grant.account_id = p_account_id
      AND pairing_grant.provider = 'baileys'
      AND pairing_grant.runtime_generation = p_generation
      AND pairing_grant.container_id = v_runtime.container_id
      AND pairing_grant.expected_connection_epoch IS NOT DISTINCT FROM
        v_grant_expected_epoch
      AND pairing_grant.authorized_connection_epoch = p_connection_epoch
      AND pairing_grant.connection_sequence_at_grant = v_grant_sequence
      AND pairing_grant.consumed_at IS NULL
      AND pairing_grant.revoked_at IS NULL
      AND pairing_grant.expires_at > clock_timestamp();
    IF NOT FOUND THEN
      RAISE EXCEPTION 'whatsapp pairing activation grant changed'
        USING ERRCODE = '40001';
    END IF;
  END IF;

  RETURN NEXT;
END;
$function$;

REVOKE ALL ON FUNCTION public.activate_whatsapp_runtime_fence(
  uuid, uuid, text, integer, uuid, text, text, uuid, uuid
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.activate_whatsapp_runtime_fence(
  uuid, uuid, text, integer, uuid, text, text, uuid, uuid
) TO whatsapp_session_runtime;
