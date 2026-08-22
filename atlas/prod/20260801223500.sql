-- PostgreSQL grants EXECUTE on new functions to PUBLIC by default. The
-- Whatsmeow lifetime-lock role shares this database but must never be able to
-- invoke privileged runtime functions. Function owners retain EXECUTE, so the
-- canonical application role continues to work without an additional grant.
REVOKE EXECUTE ON FUNCTION public.activate_whatsapp_runtime_fence(
  uuid, uuid, text, integer, uuid, text, text, uuid
) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.apply_worker_runtime_status(
  uuid, uuid, text, integer, uuid, text, text, jsonb, uuid
) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.hydrate_whatsapp_warm_runtime(
  uuid, text, text
) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.request_worker_self_heal(
  uuid, uuid, text, integer, uuid, text, text, text, jsonb, text
) FROM PUBLIC;
