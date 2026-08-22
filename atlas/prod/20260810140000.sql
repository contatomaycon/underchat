-- Runtime bootstrap uses the historical 8-argument activation boundary. The
-- stopped-status wrapper installed in 20260810120000 reaches the current
-- 9-argument function with a NULL connection attempt, while the resumable QR
-- draft wrapper installed in 20260810130000 intentionally requires a concrete
-- one-shot attempt. Keep QR activation strict, but route bootstrap calls back
-- through the grant-aware session fence that already supports a NULL attempt.

ALTER FUNCTION public.activate_whatsapp_runtime_fence(
  uuid, uuid, text, integer, uuid, text, text, uuid, uuid
) RENAME TO activate_whatsapp_runtime_fence_resumable_pairing_base;

REVOKE ALL ON FUNCTION
  public.activate_whatsapp_runtime_fence_resumable_pairing_base(
    uuid, uuid, text, integer, uuid, text, text, uuid, uuid
  ) FROM PUBLIC;
REVOKE ALL ON FUNCTION
  public.activate_whatsapp_runtime_fence_resumable_pairing_base(
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

  -- Preserve the worker-before-runtime lock order and the canonical stopped
  -- fence for both direct QR activation and the compatibility bootstrap path.
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
