-- Keep provider-handoff promotion in worker -> lease -> session lock order
-- without granting the runtime role direct access to the control-plane worker
-- table. The signed worker-operation scope is checked both before and after
-- the row lock so a waiting candidate cannot continue with stale authority.

CREATE OR REPLACE FUNCTION public.begin_whatsapp_session_lifecycle(
  p_worker_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_scope_worker_id uuid;
BEGIN
  v_scope_worker_id := nullif(
    current_setting('app.whatsapp_worker_id', true), ''
  )::uuid;

  IF p_worker_id IS NULL
    OR v_scope_worker_id IS DISTINCT FROM p_worker_id
    OR NOT public.whatsapp_worker_operation_scope_is_valid()
  THEN
    RAISE EXCEPTION 'whatsapp session lifecycle scope is unauthorized'
      USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM public.worker AS worker
  WHERE worker.worker_id = p_worker_id
    AND worker.session_storage = 'postgres'
    AND worker.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'whatsapp worker is unavailable for lifecycle operation'
      USING ERRCODE = '55000';
  END IF;

  IF NOT public.whatsapp_worker_operation_scope_is_valid() THEN
    RAISE EXCEPTION 'whatsapp session lifecycle scope changed while waiting'
      USING ERRCODE = '40001';
  END IF;

  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.begin_whatsapp_session_lifecycle(uuid)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.begin_whatsapp_session_lifecycle(uuid)
TO whatsapp_session_runtime;
