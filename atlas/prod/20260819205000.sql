-- Keep PostgreSQL HA recovery inside the durable WhatsApp session lease.
--
-- Workers currently request a 30-second lease and renew every five seconds.
-- A controlled primary transition can legitimately take slightly longer than
-- the resulting 25-second local safety window. Because acquire/renew return
-- the stored expiry, enforcing a 60-second database minimum immediately gives
-- existing workers a 55-second recovery window without weakening ownership,
-- fencing-token, generation, epoch or capability checks.
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
      NEW."heartbeat_at" + interval '60 seconds'
    );
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL
ON FUNCTION public.enforce_whatsapp_session_lease_min_ttl_v1()
FROM PUBLIC;

DROP TRIGGER IF EXISTS "whatsapp_session_lease_min_ttl_trg"
ON public."whatsapp_session_lease";

CREATE TRIGGER "whatsapp_session_lease_min_ttl_trg"
BEFORE INSERT OR UPDATE OF "owner_id", "heartbeat_at", "expires_at"
ON public."whatsapp_session_lease"
FOR EACH ROW
EXECUTE FUNCTION public.enforce_whatsapp_session_lease_min_ttl_v1();
