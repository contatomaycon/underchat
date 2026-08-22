-- Authorize an explicit post-disconnect pairing attempt without replacing the
-- runtime. The grant is durable, short-lived and one-shot; its attempt id and
-- manager-owned connection epoch travel together in the QR Redis envelope.
CREATE TABLE public.whatsapp_pairing_activation_grant (
  connection_attempt_id uuid PRIMARY KEY,
  worker_id uuid NOT NULL,
  account_id uuid NOT NULL,
  provider varchar(20) NOT NULL,
  runtime_generation integer NOT NULL,
  container_id varchar(100) NOT NULL,
  expected_connection_epoch varchar(100),
  authorized_connection_epoch uuid NOT NULL,
  connection_sequence_at_grant bigint NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT whatsapp_pairing_activation_grant_worker_fk
    FOREIGN KEY (account_id, worker_id)
    REFERENCES public.worker(account_id, worker_id)
    ON DELETE CASCADE,
  CONSTRAINT whatsapp_pairing_activation_grant_provider_check
    CHECK (provider IN ('baileys', 'wwebjs', 'whatsmeow')),
  CONSTRAINT whatsapp_pairing_activation_grant_generation_check
    CHECK (runtime_generation > 0),
  CONSTRAINT whatsapp_pairing_activation_grant_container_check
    CHECK (lower(trim(container_id)) ~ '^[0-9a-f]{12,64}$'),
  CONSTRAINT whatsapp_pairing_activation_grant_sequence_check
    CHECK (connection_sequence_at_grant >= 0),
  CONSTRAINT whatsapp_pairing_activation_grant_epoch_transition_check
    CHECK (authorized_connection_epoch::text IS DISTINCT FROM
      expected_connection_epoch),
  CONSTRAINT whatsapp_pairing_activation_grant_expiry_check
    CHECK (expires_at > created_at),
  CONSTRAINT whatsapp_pairing_activation_grant_terminal_check
    CHECK (NOT (consumed_at IS NOT NULL AND revoked_at IS NOT NULL))
);

CREATE UNIQUE INDEX whatsapp_pairing_activation_grant_epoch_uidx
  ON public.whatsapp_pairing_activation_grant(authorized_connection_epoch);

-- Covers worker/account ownership lookups over both pending and consumed
-- history and gives the cascading worker FK a non-partial child index.
CREATE INDEX whatsapp_pairing_activation_grant_worker_idx
  ON public.whatsapp_pairing_activation_grant(worker_id, account_id);

CREATE UNIQUE INDEX whatsapp_pairing_activation_grant_active_worker_uidx
  ON public.whatsapp_pairing_activation_grant(worker_id)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;

CREATE INDEX whatsapp_pairing_activation_grant_expiry_idx
  ON public.whatsapp_pairing_activation_grant(expires_at)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;

REVOKE ALL ON TABLE public.whatsapp_pairing_activation_grant FROM PUBLIC;
REVOKE ALL ON TABLE public.whatsapp_pairing_activation_grant
  FROM whatsapp_session_runtime;

-- A restarted process in the same runtime generation must reuse a
-- manager-owned epoch instead of inventing a replacement. The runtime role
-- receives only this identity-fenced projection, never direct table access.
CREATE OR REPLACE FUNCTION public.resolve_whatsapp_runtime_owned_connection_fence(
  p_worker_id uuid,
  p_account_id uuid,
  p_provider text,
  p_generation integer,
  p_writer_epoch uuid,
  p_capability text,
  p_container_id text
)
RETURNS TABLE (
  connection_epoch uuid,
  connection_attempt_id uuid,
  connection_sequence bigint,
  authorization_state text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT pairing_grant.authorized_connection_epoch,
         pairing_grant.connection_attempt_id,
         runtime.connection_sequence,
         CASE
           WHEN pairing_grant.consumed_at IS NULL THEN 'pending'::text
           ELSE 'owned'::text
         END
  FROM public.worker AS owner
  JOIN public.worker_runtime AS runtime
    ON runtime.worker_id = owner.worker_id
  JOIN public.whatsapp_pairing_activation_grant AS pairing_grant
    ON pairing_grant.worker_id = runtime.worker_id
   AND pairing_grant.account_id = owner.account_id
   AND (
     runtime.source_provider IS NULL
     OR pairing_grant.provider = runtime.source_provider
   )
   AND pairing_grant.runtime_generation = runtime.runtime_generation
   AND pairing_grant.container_id = runtime.container_id
   AND pairing_grant.revoked_at IS NULL
   AND (
     (
       pairing_grant.consumed_at IS NULL
       AND (
         (
           pairing_grant.expires_at > statement_timestamp()
           AND pairing_grant.expected_connection_epoch IS NOT DISTINCT FROM
             runtime.connection_epoch
           AND pairing_grant.connection_sequence_at_grant =
             runtime.connection_sequence
         )
         OR (
           pairing_grant.authorized_connection_epoch::text =
             runtime.connection_epoch
           AND runtime.source_provider = pairing_grant.provider
           AND runtime.connection_sequence =
             pairing_grant.connection_sequence_at_grant + 1
         )
       )
     )
     OR (
       pairing_grant.consumed_at IS NOT NULL
       AND pairing_grant.authorized_connection_epoch::text =
         runtime.connection_epoch
       AND runtime.connection_sequence =
         pairing_grant.connection_sequence_at_grant + 1
     )
   )
  WHERE owner.worker_id = p_worker_id
    AND owner.account_id = p_account_id
    AND owner.deleted_at IS NULL
    AND owner.worker_type_id = CASE lower(trim(p_provider))
      WHEN 'baileys'
        THEN '019a930d-c6f6-766d-9c84-53307d4159a1'::uuid
      WHEN 'wwebjs'
        THEN '019a930d-c6f6-766d-9c84-62b9c3e7d1f0'::uuid
      WHEN 'whatsmeow'
        THEN 'e80ad183-2b46-4628-9105-a036f2d28720'::uuid
      ELSE NULL::uuid
    END
    AND runtime.runtime_generation = p_generation
    AND runtime.session_writer_epoch = p_writer_epoch
    AND runtime.runtime_capability_hash =
      encode(public.digest(p_capability, 'sha256'), 'hex')
    AND (
      runtime.source_provider IS NULL
      OR runtime.source_provider = lower(trim(p_provider))
    )
    AND runtime.container_id IS NOT NULL
    AND (
      runtime.container_id = trim(p_container_id)
      OR runtime.container_id LIKE trim(p_container_id) || '%'
    )
  -- A pending manager attempt must be activated before a same-generation
  -- process opens its auth store. The consumed current owner is the fallback
  -- used by ordinary runtime restarts.
  ORDER BY pairing_grant.consumed_at NULLS FIRST
  LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION
  public.resolve_whatsapp_runtime_owned_connection_fence(
    uuid, uuid, text, integer, uuid, text, text
  ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  public.resolve_whatsapp_runtime_owned_connection_fence(
    uuid, uuid, text, integer, uuid, text, text
  ) TO whatsapp_session_runtime;

-- Preserve the complete activation implementation installed by the previous
-- migration, but put a grant-aware boundary in front of it. Direct 8-argument
-- callers remain compatible and fail closed whenever a disconnect tombstone
-- is active. The 9-argument overload is the only boundary allowed to consume
-- a pairing grant and release that tombstone.
ALTER FUNCTION public.activate_whatsapp_runtime_fence(
  uuid, uuid, text, integer, uuid, text, text, uuid
) RENAME TO activate_whatsapp_runtime_fence_pairing_grant_base;

REVOKE ALL ON FUNCTION
  public.activate_whatsapp_runtime_fence_pairing_grant_base(
    uuid, uuid, text, integer, uuid, text, text, uuid
  ) FROM PUBLIC;
REVOKE ALL ON FUNCTION
  public.activate_whatsapp_runtime_fence_pairing_grant_base(
    uuid, uuid, text, integer, uuid, text, text, uuid
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
  v_result record;
  v_runtime public.worker_runtime%ROWTYPE;
  v_disconnect_barrier_active boolean := false;
  v_active_grant_attempt_id uuid;
  v_active_grant_epoch uuid;
  v_active_grant_expected_epoch varchar(100);
  v_active_grant_sequence bigint;
  v_active_grant_live boolean := false;
  v_active_grant_completion boolean := false;
  v_owned_grant_attempt_id uuid;
  v_lease_released boolean := false;
  v_lease_expired boolean := false;
  v_lease_live boolean := false;
  v_session_found boolean := false;
  v_session_empty boolean := false;
  v_lease_found boolean := false;
BEGIN
  activated := false;
  already_active := false;
  connection_sequence := NULL;

  IF p_worker_id IS NULL
    OR p_account_id IS NULL
    OR p_generation IS NULL
    OR p_generation <= 0
    OR p_connection_epoch IS NULL
  THEN
    RETURN NEXT;
    RETURN;
  END IF;

  -- Global ordering stays worker -> runtime -> session -> lease. Holding the
  -- runtime lock also serializes competing grants and delayed activations.
  PERFORM 1
  FROM public.worker AS owner
  WHERE owner.worker_id = p_worker_id
    AND owner.account_id = p_account_id
    AND owner.deleted_at IS NULL
  FOR SHARE;
  IF NOT FOUND THEN
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

  v_disconnect_barrier_active :=
    v_runtime.connection_disconnected_at IS NOT NULL
    AND v_runtime.connection_epoch IS NOT DISTINCT FROM
      v_runtime.disconnected_connection_epoch;

  IF v_runtime.session_storage = 'postgres' THEN
    PERFORM set_config('app.whatsapp_session_id', p_worker_id::text, true);
    SELECT COALESCE((
      session.state IN ('empty', 'preparing')
      AND session.provider = lower(trim(p_provider))
      AND session.generation = p_generation
      AND session.epoch = p_writer_epoch
      AND session.capability_hash =
        encode(public.digest(p_capability, 'sha256'), 'hex')
      AND session.active_revision_id IS NULL
      AND session.previous_revision_id IS NULL
      AND session.active_device_fingerprint IS NULL
      AND session.active_device_fingerprint_version IS NULL
      AND session.last_persisted_at IS NULL
      AND session.last_error_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.whatsapp_session_revision
        WHERE session_id = p_worker_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.whatsapp_companion_reservation
        WHERE session_id = p_worker_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.whatsapp_session_handoff
        WHERE session_id = p_worker_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.whatsapp_session_gc_queue
        WHERE session_id = p_worker_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.whatsapp_provider_record
        WHERE session_id = p_worker_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.whatsapp_artifact
        WHERE session_id = p_worker_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.whatsapp_wwebjs_profile_anchor
        WHERE session_id = p_worker_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.whatsapp_artifact_chunk
        WHERE session_id = p_worker_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.whatsapp_artifact_blob
        WHERE session_id = p_worker_id
      )
    ), false)
    INTO v_session_empty
    FROM public.whatsapp_session AS session
    WHERE session.session_id = p_worker_id
    FOR SHARE;
    v_session_found := FOUND;

    SELECT
      lease.fencing_token > 0
        AND lease.generation = p_generation
        AND lease.owner_id IS NULL
        AND lease.provider IS NULL
        AND lease.epoch IS NULL
        AND lease.expires_at IS NULL,
      lease.fencing_token > 0
        AND lease.owner_id IS NOT NULL
        AND lease.provider = lower(trim(p_provider))
        AND lease.generation = p_generation
        AND lease.epoch = p_writer_epoch
        AND lease.expires_at <= clock_timestamp(),
      lease.fencing_token > 0
        AND lease.owner_id IS NOT NULL
        AND lease.provider = lower(trim(p_provider))
        AND lease.generation = p_generation
        AND lease.epoch = p_writer_epoch
        AND lease.expires_at > clock_timestamp()
    INTO v_lease_released, v_lease_expired, v_lease_live
    FROM public.whatsapp_session_lease AS lease
    WHERE lease.session_id = p_worker_id
    FOR UPDATE;
    v_lease_found := FOUND;
  END IF;

  -- The partial unique index guarantees at most one candidate. Locking it
  -- makes grant consumption and a competing activation mutually exclusive.
  SELECT pairing_grant.connection_attempt_id,
         pairing_grant.authorized_connection_epoch,
         pairing_grant.expected_connection_epoch,
         pairing_grant.connection_sequence_at_grant,
         pairing_grant.expires_at > clock_timestamp()
  INTO v_active_grant_attempt_id,
       v_active_grant_epoch,
       v_active_grant_expected_epoch,
       v_active_grant_sequence,
       v_active_grant_live
  FROM public.whatsapp_pairing_activation_grant AS pairing_grant
  WHERE pairing_grant.worker_id = p_worker_id
    AND pairing_grant.account_id = p_account_id
    AND pairing_grant.provider = lower(trim(p_provider))
    AND pairing_grant.runtime_generation = p_generation
    AND pairing_grant.container_id = v_runtime.container_id
    AND pairing_grant.consumed_at IS NULL
    AND pairing_grant.revoked_at IS NULL
  FOR UPDATE;

  -- If the runtime epoch/sequence already reflect this exact pending grant,
  -- the activation committed but the one-shot marker was not finalized by an
  -- older implementation. The exact attempt may complete ownership even when
  -- its short request TTL has elapsed; no different attempt/epoch can do so.
  v_active_grant_completion := COALESCE((
      NOT v_disconnect_barrier_active
      AND v_active_grant_attempt_id IS NOT NULL
      AND p_connection_attempt_id IS NOT NULL
      AND v_active_grant_attempt_id = p_connection_attempt_id
      AND v_active_grant_epoch = p_connection_epoch
      AND v_runtime.connection_epoch = p_connection_epoch::text
      AND v_runtime.source_provider = lower(trim(p_provider))
      AND v_runtime.connection_sequence = v_active_grant_sequence + 1
    ), false);

  IF v_disconnect_barrier_active THEN
    IF NOT v_active_grant_live
      OR p_connection_attempt_id IS NULL
      OR v_active_grant_attempt_id IS DISTINCT FROM p_connection_attempt_id
      OR v_active_grant_epoch IS DISTINCT FROM p_connection_epoch
      OR v_active_grant_expected_epoch IS DISTINCT FROM
        v_runtime.disconnected_connection_epoch
      OR v_active_grant_sequence IS DISTINCT FROM
        v_runtime.connection_sequence
    THEN
      RETURN NEXT;
      RETURN;
    END IF;

    -- A live lease still belongs to the disconnected store and must not be
    -- displaced by a same-generation pairing attempt. Expired/released leases
    -- are safe: the next acquire advances the token, fencing the old owner.
    IF v_runtime.session_storage = 'postgres' THEN
      IF NOT v_session_found
        OR NOT v_session_empty
        OR NOT v_lease_found
        OR NOT (v_lease_released OR v_lease_expired)
      THEN
        RETURN NEXT;
        RETURN;
      END IF;
    END IF;
  ELSE
    -- A consumed grant owns its active epoch for the remainder of this
    -- runtime generation. Random recovery epochs and delayed activations may
    -- not replace it. The exact attempt+epoch retry remains idempotent.
    SELECT pairing_grant.connection_attempt_id
    INTO v_owned_grant_attempt_id
    FROM public.whatsapp_pairing_activation_grant AS pairing_grant
    WHERE pairing_grant.worker_id = p_worker_id
      AND pairing_grant.account_id = p_account_id
      AND pairing_grant.provider = lower(trim(p_provider))
      AND pairing_grant.runtime_generation = p_generation
      AND pairing_grant.container_id = v_runtime.container_id
      AND pairing_grant.authorized_connection_epoch::text =
        v_runtime.connection_epoch
      AND pairing_grant.consumed_at IS NOT NULL
      AND pairing_grant.revoked_at IS NULL
    ORDER BY pairing_grant.consumed_at DESC
    LIMIT 1
    FOR UPDATE;

    IF v_active_grant_attempt_id IS NOT NULL THEN
      -- A fresh manager grant B may deliberately replace owned epoch A. Its
      -- CAS snapshot makes a delayed/random epoch C fail closed.
      IF NOT v_active_grant_completion THEN
        IF NOT v_active_grant_live
          OR p_connection_attempt_id IS DISTINCT FROM
            v_active_grant_attempt_id
          OR p_connection_epoch IS DISTINCT FROM v_active_grant_epoch
          OR v_active_grant_expected_epoch IS DISTINCT FROM
            v_runtime.connection_epoch
          OR v_active_grant_sequence IS DISTINCT FROM
            v_runtime.connection_sequence
        THEN
          RETURN NEXT;
          RETURN;
        END IF;

        IF v_runtime.session_storage = 'postgres' THEN
          IF NOT v_session_found
            OR NOT v_session_empty
            OR NOT v_lease_found
            OR NOT (
              v_lease_released OR v_lease_expired OR v_lease_live
            )
          THEN
            RETURN NEXT;
            RETURN;
          END IF;
        END IF;
      END IF;
    ELSIF v_owned_grant_attempt_id IS NOT NULL THEN
      -- Runtime bootstrap may resolve and repeat the owned epoch without the
      -- original manager envelope. Supplying an attempt id is accepted only
      -- when it is that exact consumed owner.
      IF p_connection_epoch::text IS DISTINCT FROM
          v_runtime.connection_epoch
        OR (
          p_connection_attempt_id IS NOT NULL
          AND p_connection_attempt_id IS DISTINCT FROM
            v_owned_grant_attempt_id
        )
      THEN
        RETURN NEXT;
        RETURN;
      END IF;
    END IF;
  END IF;

  SELECT result.activated,
         result.already_active,
         result.connection_sequence
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
  ) AS result;

  activated := COALESCE(v_result.activated, false);
  already_active := COALESCE(v_result.already_active, false);
  connection_sequence := v_result.connection_sequence;

  IF activated
    AND v_active_grant_attempt_id IS NOT NULL
    AND p_connection_attempt_id = v_active_grant_attempt_id
  THEN
    UPDATE public.whatsapp_pairing_activation_grant AS pairing_grant
    SET consumed_at = clock_timestamp()
    WHERE pairing_grant.connection_attempt_id = p_connection_attempt_id
      AND pairing_grant.worker_id = p_worker_id
      AND pairing_grant.account_id = p_account_id
      AND pairing_grant.provider = lower(trim(p_provider))
      AND pairing_grant.runtime_generation = p_generation
      AND pairing_grant.container_id = v_runtime.container_id
      AND pairing_grant.expected_connection_epoch IS NOT DISTINCT FROM
        v_active_grant_expected_epoch
      AND pairing_grant.authorized_connection_epoch = p_connection_epoch
      AND pairing_grant.connection_sequence_at_grant = v_active_grant_sequence
      AND pairing_grant.consumed_at IS NULL
      AND pairing_grant.revoked_at IS NULL
      AND (
        v_active_grant_completion
        OR pairing_grant.expires_at > clock_timestamp()
      );
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
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT result.activated, result.already_active, result.connection_sequence
  FROM public.activate_whatsapp_runtime_fence(
    p_worker_id,
    p_account_id,
    p_provider,
    p_generation,
    p_writer_epoch,
    p_capability,
    p_container_id,
    p_connection_epoch,
    NULL::uuid
  ) AS result;
$function$;

REVOKE ALL ON FUNCTION public.activate_whatsapp_runtime_fence(
  uuid, uuid, text, integer, uuid, text, text, uuid
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.activate_whatsapp_runtime_fence(
  uuid, uuid, text, integer, uuid, text, text, uuid
) TO whatsapp_session_runtime;
