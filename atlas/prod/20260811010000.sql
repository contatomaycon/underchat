-- Keep the durable worker status monotonic while an explicitly authorized
-- pairing attempt is active. This boundary is shared by Baileys, WWebJS and
-- WhatsMeow and is independent of legacy-volume versus PostgreSQL auth storage.
-- Provider-native offline/recovery snapshots remain valid diagnostics, but
-- they cannot demote the operational worker status before the attempt reaches
-- an explicitly correlated terminal state.
ALTER FUNCTION public.apply_worker_runtime_status(
  uuid, uuid, text, integer, uuid, text, text, jsonb, uuid
) RENAME TO apply_worker_runtime_status_pairing_status_base;

REVOKE ALL ON FUNCTION public.apply_worker_runtime_status_pairing_status_base(
  uuid, uuid, text, integer, uuid, text, text, jsonb, uuid
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_worker_runtime_status_pairing_status_base(
  uuid, uuid, text, integer, uuid, text, text, jsonb, uuid
) FROM whatsapp_session_runtime;

CREATE OR REPLACE FUNCTION public.apply_worker_runtime_status(
  p_worker_id uuid,
  p_account_id uuid,
  p_provider text,
  p_generation integer,
  p_writer_epoch uuid,
  p_capability text,
  p_container_id text,
  p_status jsonb,
  p_event_id uuid
)
RETURNS TABLE (
  outcome text,
  event_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_status jsonb := p_status;
  v_current_worker_status_id uuid;
  v_requested_worker_status_id uuid;
  v_connection_attempt_id uuid;
  v_active_pairing boolean := false;
  v_pairing_progress boolean := false;
  v_explicit_terminal boolean := false;
  v_attempt_text text := lower(trim(COALESCE(
    p_status ->> 'connection_attempt_id',
    ''
  )));
BEGIN
  -- Preserve the lock order used by lifecycle and disconnect finalizers.
  SELECT owner.worker_status_id
  INTO v_current_worker_status_id
  FROM public.worker AS owner
  WHERE owner.worker_id = p_worker_id
    AND owner.account_id = p_account_id
    AND owner.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    outcome := 'stale';
    event_id := p_event_id;
    RETURN NEXT;
    RETURN;
  END IF;

  PERFORM 1
  FROM public.worker_runtime AS runtime
  WHERE runtime.worker_id = p_worker_id
    AND runtime.runtime_generation = p_generation
  FOR UPDATE;

  IF NOT FOUND THEN
    outcome := 'stale';
    event_id := p_event_id;
    RETURN NEXT;
    RETURN;
  END IF;

  BEGIN
    v_requested_worker_status_id := NULLIF(
      trim(COALESCE(p_status ->> 'worker_status_id', '')),
      ''
    )::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_requested_worker_status_id := NULL;
  END;

  IF v_attempt_text ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  THEN
    v_connection_attempt_id := v_attempt_text::uuid;

    SELECT EXISTS (
      SELECT 1
      FROM public.worker AS owner
      JOIN public.worker_runtime AS runtime
        ON runtime.worker_id = owner.worker_id
      JOIN public.whatsapp_pairing_activation_grant AS pairing_grant
        ON pairing_grant.worker_id = runtime.worker_id
       AND pairing_grant.account_id = owner.account_id
       AND pairing_grant.connection_attempt_id = v_connection_attempt_id
       AND pairing_grant.provider = lower(trim(p_provider))
       AND pairing_grant.runtime_generation = runtime.runtime_generation
       AND pairing_grant.container_id = runtime.container_id
       AND pairing_grant.revoked_at IS NULL
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
        AND runtime.container_id IS NOT NULL
        AND (
          runtime.container_id = trim(p_container_id)
          OR runtime.container_id LIKE trim(p_container_id) || '%'
        )
        AND (
          (
            pairing_grant.consumed_at IS NULL
            AND pairing_grant.expires_at > statement_timestamp()
            AND pairing_grant.expected_connection_epoch IS NOT DISTINCT FROM
              runtime.connection_epoch
            AND pairing_grant.connection_sequence_at_grant =
              runtime.connection_sequence
          )
          OR (
            pairing_grant.authorized_connection_epoch::text =
              runtime.connection_epoch
            AND runtime.connection_sequence =
              pairing_grant.connection_sequence_at_grant + 1
          )
        )
    ) INTO v_active_pairing;
  END IF;

  v_pairing_progress :=
    lower(COALESCE(p_status ->> 'qr_pending', 'false')) = 'true'
    OR COALESCE(p_status ->> 'code', '') IN (
      '201', '202', '203', '204', '206', '207', '208'
    )
    OR lower(COALESCE(p_status ->> 'status', '')) = 'connecting'
    OR lower(COALESCE(
      p_status -> 'connection_status' ->> 'recoverable',
      'false'
    )) = 'true'
    OR lower(COALESCE(
      p_status -> 'connection_status' ->> 'status',
      ''
    )) IN (
      'initializing', 'restoring', 'connecting', 'qr', 'reconnecting',
      'handoff'
    );

  v_explicit_terminal :=
    lower(COALESCE(p_status ->> 'disconnected_user', 'false')) = 'true'
    OR (
      NOT v_pairing_progress
      AND (
        lower(COALESCE(p_status ->> 'status', '')) = 'disconnected'
        OR COALESCE(p_status ->> 'code', '') IN (
          '401', '403', '408', '411', '428', '440', '500', '600'
        )
        OR lower(COALESCE(
          p_status -> 'connection_status' ->> 'status',
          ''
        )) IN (
          'logged_out', 'invalid_session', 'conflict', 'lease_lost',
          'stopped', 'error'
        )
      )
    );

  IF v_active_pairing THEN
    -- QR consumption is the only pre-ONLINE transition allowed to promote the
    -- durable status to CONNECTING. All three providers use these canonical
    -- codes at this exact boundary.
    IF COALESCE(p_status ->> 'code', '') IN ('201', '206') THEN
      v_status := jsonb_set(
        v_status,
        '{worker_status_id}',
        to_jsonb('019fee6d-09b1-752b-b759-943c3743db7e'::text),
        true
      );
    ELSIF NOT v_explicit_terminal
      AND v_current_worker_status_id =
        '019a930d-c6f6-766d-9c84-3904383fe742'::uuid
      AND v_requested_worker_status_id =
        '019a930d-c6f6-766d-9c84-3696c2cd5ed8'::uuid
    THEN
      v_status := jsonb_set(
        v_status,
        '{worker_status_id}',
        to_jsonb(v_current_worker_status_id::text),
        true
      );
    ELSIF NOT v_explicit_terminal
      AND v_current_worker_status_id =
        '019fee6d-09b1-752b-b759-943c3743db7e'::uuid
      AND v_requested_worker_status_id IN (
        '019a930d-c6f6-766d-9c84-3904383fe742'::uuid,
        '019a930d-c6f6-766d-9c84-3696c2cd5ed8'::uuid
      )
    THEN
      v_status := jsonb_set(
        v_status,
        '{worker_status_id}',
        to_jsonb(v_current_worker_status_id::text),
        true
      );
    END IF;
  END IF;

  RETURN QUERY
  SELECT applied.outcome, applied.event_id
  FROM public.apply_worker_runtime_status_pairing_status_base(
    p_worker_id,
    p_account_id,
    p_provider,
    p_generation,
    p_writer_epoch,
    p_capability,
    p_container_id,
    v_status,
    p_event_id
  ) AS applied;
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_worker_runtime_status(
  uuid, uuid, text, integer, uuid, text, text, jsonb, uuid
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_worker_runtime_status(
  uuid, uuid, text, integer, uuid, text, text, jsonb, uuid
) TO whatsapp_session_runtime;
