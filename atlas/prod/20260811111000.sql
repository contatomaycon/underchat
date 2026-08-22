-- Complete autonomous runtime recovery around QR ownership. An expired grant
-- that was never activated must not keep an otherwise valid physical runtime
-- in a permanent restart loop. Only an exactly authenticated runtime identity
-- may retire that stale grant. Pending live grants resume through the strict
-- resumable pairing path; an already-consumed owner resumes through the
-- canonical session path with its existing epoch.

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
  v_runtime_identity_valid boolean := false;
  v_runtime_connection_epoch varchar(100);
  v_runtime_connection_sequence bigint;
  v_runtime_source_provider varchar(20);
  v_owned_connection_epoch uuid;
  v_owned_connection_attempt_id uuid;
  v_owned_authorization_state text;
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
  THEN
    RETURN NEXT;
    RETURN;
  END IF;

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

  IF p_connection_attempt_id IS NULL THEN
    SELECT true,
           runtime.connection_epoch,
           runtime.connection_sequence,
           runtime.source_provider
    INTO v_runtime_identity_valid,
         v_runtime_connection_epoch,
         v_runtime_connection_sequence,
         v_runtime_source_provider
    FROM public.worker_runtime AS runtime
    JOIN public.worker AS owner
      ON owner.worker_id = runtime.worker_id
     AND owner.account_id = p_account_id
    WHERE runtime.worker_id = p_worker_id
      AND runtime.runtime_generation = p_generation
      AND runtime.session_writer_epoch = p_writer_epoch
      AND runtime.runtime_capability_hash =
        encode(public.digest(p_capability, 'sha256'), 'hex')
      AND runtime.container_id IS NOT NULL
      AND (
        runtime.container_id = trim(p_container_id)
        OR runtime.container_id LIKE trim(p_container_id) || '%'
      )
      AND (
        runtime.source_provider IS NULL
        OR runtime.source_provider = lower(trim(p_provider))
      )
      AND owner.worker_type_id = CASE lower(trim(p_provider))
        WHEN 'baileys'
          THEN '019a930d-c6f6-766d-9c84-53307d4159a1'::uuid
        WHEN 'wwebjs'
          THEN '019a930d-c6f6-766d-9c84-62b9c3e7d1f0'::uuid
        WHEN 'whatsmeow'
          THEN 'e80ad183-2b46-4628-9105-a036f2d28720'::uuid
        ELSE NULL::uuid
      END
    FOR UPDATE OF runtime;

    IF COALESCE(v_runtime_identity_valid, false) THEN
      UPDATE public.whatsapp_pairing_activation_grant AS pairing_grant
      SET revoked_at = clock_timestamp()
      WHERE pairing_grant.worker_id = p_worker_id
        AND pairing_grant.account_id = p_account_id
        AND pairing_grant.provider = lower(trim(p_provider))
        AND pairing_grant.runtime_generation = p_generation
        AND (
          pairing_grant.container_id = trim(p_container_id)
          OR pairing_grant.container_id LIKE trim(p_container_id) || '%'
        )
        AND pairing_grant.consumed_at IS NULL
        AND pairing_grant.revoked_at IS NULL
        AND pairing_grant.expires_at <= clock_timestamp()
        AND NOT (
          pairing_grant.authorized_connection_epoch::text IS NOT DISTINCT FROM
            v_runtime_connection_epoch
          AND v_runtime_source_provider = pairing_grant.provider
          AND v_runtime_connection_sequence =
            pairing_grant.connection_sequence_at_grant + 1
        );
    END IF;

    SELECT owned.connection_epoch,
           owned.connection_attempt_id,
           owned.authorization_state
    INTO v_owned_connection_epoch,
         v_owned_connection_attempt_id,
         v_owned_authorization_state
    FROM public.resolve_whatsapp_runtime_owned_connection_fence(
      p_worker_id,
      p_account_id,
      p_provider,
      p_generation,
      p_writer_epoch,
      p_capability,
      p_container_id
    ) AS owned;

    IF v_owned_connection_epoch IS NOT NULL
      AND v_owned_connection_attempt_id IS NOT NULL
      AND v_owned_authorization_state = 'pending'
    THEN
      RETURN QUERY
      SELECT resumed.activated,
             resumed.already_active,
             resumed.connection_sequence
      FROM public.activate_whatsapp_runtime_fence_resumable_pairing_base(
        p_worker_id,
        p_account_id,
        p_provider,
        p_generation,
        p_writer_epoch,
        p_capability,
        p_container_id,
        v_owned_connection_epoch,
        v_owned_connection_attempt_id
      ) AS resumed;
      RETURN;
    END IF;

    IF v_owned_connection_epoch IS NOT NULL
      AND v_owned_connection_attempt_id IS NOT NULL
      AND v_owned_authorization_state = 'owned'
    THEN
      RETURN QUERY
      SELECT resumed.activated,
             resumed.already_active,
             resumed.connection_sequence
      FROM public.activate_whatsapp_runtime_fence_pairing_session_base(
        p_worker_id,
        p_account_id,
        p_provider,
        p_generation,
        p_writer_epoch,
        p_capability,
        p_container_id,
        v_owned_connection_epoch,
        v_owned_connection_attempt_id
      ) AS resumed;
      RETURN;
    END IF;

    RETURN QUERY
    SELECT bootstrap.activated,
           bootstrap.already_active,
           bootstrap.connection_sequence
    FROM public.activate_whatsapp_runtime_fence_pairing_session_base(
      p_worker_id,
      p_account_id,
      p_provider,
      p_generation,
      p_writer_epoch,
      p_capability,
      p_container_id,
      p_connection_epoch,
      NULL::uuid
    ) AS bootstrap;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT pairing.activated,
         pairing.already_active,
         pairing.connection_sequence
  FROM public.activate_whatsapp_runtime_fence_resumable_pairing_base(
    p_worker_id,
    p_account_id,
    p_provider,
    p_generation,
    p_writer_epoch,
    p_capability,
    p_container_id,
    p_connection_epoch,
    p_connection_attempt_id
  ) AS pairing;
END;
$function$;

REVOKE ALL ON FUNCTION public.activate_whatsapp_runtime_fence(
  uuid, uuid, text, integer, uuid, text, text, uuid, uuid
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.activate_whatsapp_runtime_fence(
  uuid, uuid, text, integer, uuid, text, text, uuid, uuid
) TO whatsapp_session_runtime;
