-- A supervised switchover completed inside the bounded PostgreSQL stop window,
-- but the tail of the PgBouncer/worker reconnect queue exceeded 60 seconds for
-- a small number of sessions. Keep enough margin for that queue while the
-- separate 45-second Redis effect lease continues to fence external effects.
CREATE OR REPLACE FUNCTION public.enforce_whatsapp_session_lease_min_ttl_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF NEW."owner_id" IS NOT NULL
    AND NEW."heartbeat_at" IS NOT NULL
    AND NEW."expires_at" IS NOT NULL
  THEN
    NEW."expires_at" := GREATEST(
      NEW."expires_at",
      NEW."heartbeat_at" + interval '90 seconds'
    );
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL
ON FUNCTION public.enforce_whatsapp_session_lease_min_ttl_v1()
FROM PUBLIC;
