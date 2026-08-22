-- Authenticate and install the complete signed worker-operation scope while
-- acquiring the worker row before any session row. This replaces the initial
-- single-argument boundary, which expected a scope that had not yet been
-- installed in a fresh lifecycle transaction.

REVOKE ALL ON FUNCTION public.begin_whatsapp_session_lifecycle(uuid)
FROM PUBLIC, whatsapp_session_runtime;
DROP FUNCTION public.begin_whatsapp_session_lifecycle(uuid);

CREATE OR REPLACE FUNCTION public.begin_whatsapp_session_lifecycle(
  p_worker_id uuid,
  p_account_id uuid,
  p_provider text,
  p_generation integer,
  p_writer_epoch uuid,
  p_capability text,
  p_container_id text
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_provider text := lower(trim(p_provider));
  v_expected_worker_type uuid;
  v_capability_hash text;
  v_scoped boolean;
BEGIN
  IF p_worker_id IS NULL OR p_account_id IS NULL
    OR p_generation IS NULL OR p_generation <= 0
    OR p_writer_epoch IS NULL
    OR p_capability IS NULL OR length(p_capability) < 32
    OR length(p_capability) > 512
    OR p_container_id IS NULL
    OR trim(p_container_id) !~ '^[0-9a-f]{12,64}$'
  THEN
    RAISE EXCEPTION 'invalid whatsapp session lifecycle arguments'
      USING ERRCODE = '22023';
  END IF;

  v_expected_worker_type := CASE v_provider
    WHEN 'baileys' THEN '019a930d-c6f6-766d-9c84-53307d4159a1'::uuid
    WHEN 'wwebjs' THEN '019a930d-c6f6-766d-9c84-62b9c3e7d1f0'::uuid
    WHEN 'whatsmeow' THEN 'e80ad183-2b46-4628-9105-a036f2d28720'::uuid
    ELSE NULL
  END;
  IF v_expected_worker_type IS NULL THEN
    RAISE EXCEPTION 'invalid whatsapp session lifecycle provider'
      USING ERRCODE = '22023';
  END IF;

  v_capability_hash := encode(public.digest(p_capability, 'sha256'), 'hex');

  -- Prove the exact physical runtime before granting it a control-plane lock.
  -- Cross-provider candidates remain source-authoritative until promotion, so
  -- the manager lifecycle row is part of the authorization predicate.
  PERFORM 1
  FROM public.worker AS worker
  JOIN public.worker_runtime AS runtime
    ON runtime.worker_id = worker.worker_id
  WHERE worker.worker_id = p_worker_id
    AND worker.account_id = p_account_id
    AND (
      worker.worker_type_id = v_expected_worker_type
      OR (
        worker.session_storage = 'postgres'
        AND EXISTS (
          SELECT 1
          FROM public.whatsapp_session_handoff AS target_handoff
          WHERE target_handoff.session_id = worker.worker_id
            AND target_handoff.lifecycle_operation_id = worker.lifecycle_operation_id
            AND target_handoff.target_provider = v_provider
            AND worker.worker_type_id = CASE target_handoff.source_provider
              WHEN 'baileys' THEN '019a930d-c6f6-766d-9c84-53307d4159a1'::uuid
              WHEN 'wwebjs' THEN '019a930d-c6f6-766d-9c84-62b9c3e7d1f0'::uuid
              WHEN 'whatsmeow' THEN 'e80ad183-2b46-4628-9105-a036f2d28720'::uuid
            END
            AND target_handoff.state IN (
              'transforming', 'hydrating', 'validating', 'promoting'
            )
        )
      )
    )
    AND worker.deleted_at IS NULL
    AND worker.session_storage = 'postgres'
    AND runtime.runtime_generation = p_generation
    AND runtime.session_writer_epoch = p_writer_epoch
    AND runtime.runtime_capability_hash = v_capability_hash
    AND runtime.session_storage = worker.session_storage
    AND runtime.container_id IS NOT NULL
    AND (
      runtime.container_id = trim(p_container_id)
      OR runtime.container_id LIKE trim(p_container_id) || '%'
    )
    AND runtime.source_provider = v_provider
    AND runtime.connection_sequence > 0
  FOR UPDATE OF worker, runtime;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stale or unauthorized whatsapp session lifecycle'
      USING ERRCODE = '55000';
  END IF;

  -- The worker is already locked exclusively, so this canonical scope
  -- installer can validate/lock runtime and session rows without inverting the
  -- lifecycle lock order. It also mints the transaction-bound HMAC signature.
  v_scoped := public.begin_whatsapp_worker_operation(
    p_worker_id, p_account_id, v_provider, p_generation,
    p_writer_epoch, p_capability, p_container_id
  );
  IF NOT COALESCE(v_scoped, false) THEN
    RAISE EXCEPTION 'whatsapp session lifecycle scope was rejected'
      USING ERRCODE = '55000';
  END IF;

  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.begin_whatsapp_session_lifecycle(
  uuid, uuid, text, integer, uuid, text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.begin_whatsapp_session_lifecycle(
  uuid, uuid, text, integer, uuid, text, text
) TO whatsapp_session_runtime;
