-- A strong ONLINE event from the pre-existing runtime can race the recreate
-- consumer after the worker lifecycle CAS and before the replacement starts.
-- Accept ONLINE during a recreate only after the exact current operation has
-- durably marked the replacement bootstrap on worker_runtime.
--
-- This wrapper was transactionally pre-applied to production during the
-- worker rollout before Atlas recorded the revision. Reconcile that exact
-- state without wrapping the wrapper a second time. Any other name collision
-- still fails closed.
DO $migration$
DECLARE
  v_current regprocedure := pg_catalog.to_regprocedure(
    'public.apply_worker_runtime_status(uuid,uuid,text,integer,uuid,text,text,jsonb,uuid)'
  );
  v_base regprocedure := pg_catalog.to_regprocedure(
    'public.apply_worker_runtime_status_recreate_bootstrap_base(uuid,uuid,text,integer,uuid,text,text,jsonb,uuid)'
  );
  v_current_source text;
  v_base_source text;
BEGIN
  IF v_current IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '42883',
      MESSAGE = 'apply_worker_runtime_status is required before installing the recreate bootstrap gate';
  END IF;

  IF v_base IS NULL THEN
    ALTER FUNCTION public.apply_worker_runtime_status(
      uuid, uuid, text, integer, uuid, text, text, jsonb, uuid
    ) RENAME TO apply_worker_runtime_status_recreate_bootstrap_base;
  ELSE
    SELECT routine.prosrc
    INTO v_current_source
    FROM pg_catalog.pg_proc AS routine
    WHERE routine.oid = v_current;

    SELECT routine.prosrc
    INTO v_base_source
    FROM pg_catalog.pg_proc AS routine
    WHERE routine.oid = v_base;

    IF pg_catalog.strpos(
         v_current_source,
         'v_requires_recreate_bootstrap'
       ) = 0
       OR pg_catalog.strpos(
         v_current_source,
         'FROM public.apply_worker_runtime_status_recreate_bootstrap_base('
       ) = 0
       OR pg_catalog.strpos(
         v_base_source,
         'FROM public.apply_worker_runtime_status_pairing_status_base('
       ) = 0 THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'apply_worker_runtime_status recreate bootstrap base name collision';
    END IF;
  END IF;
END;
$migration$;

REVOKE ALL ON FUNCTION public.apply_worker_runtime_status_recreate_bootstrap_base(
  uuid, uuid, text, integer, uuid, text, text, jsonb, uuid
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_worker_runtime_status_recreate_bootstrap_base(
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
  v_worker_status_id uuid;
  v_lifecycle_operation_id uuid;
  v_runtime public.worker_runtime%ROWTYPE;
  v_event_type text := COALESCE(
    NULLIF(trim(p_status ->> 'event_type'), ''),
    'status'
  );
  v_requested_status text := lower(trim(COALESCE(
    p_status ->> 'worker_status_id',
    ''
  )));
  v_runtime_found boolean := false;
  v_requires_recreate_bootstrap boolean := false;
  v_has_current_recreate_bootstrap boolean := false;
BEGIN
  -- Preserve the worker -> runtime lock order used by all lifecycle paths.
  SELECT owner.worker_status_id, owner.lifecycle_operation_id
  INTO v_worker_status_id, v_lifecycle_operation_id
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

  SELECT runtime.*
  INTO v_runtime
  FROM public.worker_runtime AS runtime
  WHERE runtime.worker_id = p_worker_id
    AND runtime.runtime_generation = p_generation
  FOR UPDATE;
  v_runtime_found := FOUND;

  v_requires_recreate_bootstrap :=
    v_event_type = 'status'
    AND v_requested_status =
      '019a930d-c6f6-766d-9c84-30af6ecc33b2'
    AND v_lifecycle_operation_id IS NOT NULL
    AND v_worker_status_id IN (
      '019a930d-c6f6-766d-9c84-46093814d8e0'::uuid,
      '019a930d-c6f6-766d-9c84-30af6ecc33b2'::uuid
    );

  IF v_requires_recreate_bootstrap THEN
    v_has_current_recreate_bootstrap :=
      v_runtime_found
      AND v_runtime.recreate_bootstrap_operation_id IS NOT DISTINCT FROM
        v_lifecycle_operation_id
      AND v_runtime.recreate_bootstrap_runtime_generation IS NOT DISTINCT FROM
        p_generation
      AND lower(trim(v_runtime.recreate_bootstrap_container_id))
        IS NOT DISTINCT FROM lower(trim(v_runtime.container_id))
      AND v_runtime.recreate_bootstrap_started_at IS NOT NULL
      AND v_runtime.recreate_retired_operation_id IS NULL
      AND v_runtime.recreate_retired_runtime_generation IS NULL
      AND v_runtime.recreate_retired_container_id IS NULL
      AND v_runtime.recreate_retired_at IS NULL;

    IF NOT v_has_current_recreate_bootstrap THEN
      outcome := 'deferred';
      event_id := p_event_id;
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  RETURN QUERY
  SELECT applied.outcome, applied.event_id
  FROM public.apply_worker_runtime_status_recreate_bootstrap_base(
    p_worker_id,
    p_account_id,
    p_provider,
    p_generation,
    p_writer_epoch,
    p_capability,
    p_container_id,
    p_status,
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
