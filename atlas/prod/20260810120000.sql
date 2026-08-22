-- Preserve the historical UUID used by plan enforcement while giving a
-- physically stopped runtime its own canonical worker status.
UPDATE "worker_status"
SET
  "status" = 'blocked',
  "updated_at" = CURRENT_TIMESTAMP
WHERE "worker_status_id" = '019bcd18-ce66-77a2-9d7c-e48159c253da';

INSERT INTO "worker_status" ("worker_status_id", "status")
VALUES ('019feb94-c2ff-76b1-9d00-d7602a50affe', 'stopped');

-- A Docker-confirmed stop is a control-plane fence. Both PostgreSQL-backed
-- and legacy-volume workers report through this same function, so reject any
-- delayed provider event before it can move worker.worker_status_id away from
-- the canonical stopped state.
ALTER FUNCTION public.apply_worker_runtime_status(
  uuid, uuid, text, integer, uuid, text, text, jsonb, uuid
) RENAME TO apply_worker_runtime_status_stopped_base;

REVOKE ALL ON FUNCTION public.apply_worker_runtime_status_stopped_base(
  uuid, uuid, text, integer, uuid, text, text, jsonb, uuid
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_worker_runtime_status_stopped_base(
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
BEGIN
  SELECT owner.worker_status_id
  INTO v_worker_status_id
  FROM public.worker AS owner
  WHERE owner.worker_id = p_worker_id
    AND owner.account_id = p_account_id
    AND owner.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND
    OR v_worker_status_id = '019feb94-c2ff-76b1-9d00-d7602a50affe'::uuid
  THEN
    outcome := 'stale';
    event_id := p_event_id;
    RETURN NEXT;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT applied.outcome, applied.event_id
  FROM public.apply_worker_runtime_status_stopped_base(
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

-- Fence activation as well as status publication. A delayed provider must not
-- reactivate a session while the canonical worker row says that its runtime is
-- physically stopped; an explicit recreate first moves the worker to its
-- lifecycle state and is therefore still allowed to activate the replacement.
ALTER FUNCTION public.activate_whatsapp_runtime_fence(
  uuid, uuid, text, integer, uuid, text, text, uuid
) RENAME TO activate_whatsapp_runtime_fence_stopped_base;

REVOKE ALL ON FUNCTION public.activate_whatsapp_runtime_fence_stopped_base(
  uuid, uuid, text, integer, uuid, text, text, uuid
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.activate_whatsapp_runtime_fence_stopped_base(
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
  p_connection_epoch uuid
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
BEGIN
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
    activated := false;
    already_active := false;
    connection_sequence := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT activation.activated,
         activation.already_active,
         activation.connection_sequence
  FROM public.activate_whatsapp_runtime_fence_stopped_base(
    p_worker_id,
    p_account_id,
    p_provider,
    p_generation,
    p_writer_epoch,
    p_capability,
    p_container_id,
    p_connection_epoch
  ) AS activation;
END;
$function$;

REVOKE ALL ON FUNCTION public.activate_whatsapp_runtime_fence(
  uuid, uuid, text, integer, uuid, text, text, uuid
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.activate_whatsapp_runtime_fence(
  uuid, uuid, text, integer, uuid, text, text, uuid
) TO whatsapp_session_runtime;
