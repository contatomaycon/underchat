-- Allow a runtime generation that was already activated by the control-plane
-- fence to take ownership immediately. This avoids waiting for the previous
-- 30-second lease TTL after a crashed/frozen container, while the monotonic
-- token still prevents the retired writer from mutating session state.
CREATE OR REPLACE FUNCTION public.acquire_whatsapp_session_lease(
  p_session_id uuid,
  p_owner_id uuid,
  p_provider text,
  p_generation integer,
  p_epoch uuid,
  p_ttl_ms integer,
  p_capability text
)
RETURNS TABLE(
  fencing_token bigint,
  expires_at timestamp with time zone,
  remaining_ms bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_now timestamptz;
  v_expires_at timestamptz;
  v_capability_hash text;
BEGIN
  IF p_session_id IS NULL OR p_owner_id IS NULL OR p_epoch IS NULL
    OR p_generation <= 0 OR p_ttl_ms < 5000 OR p_ttl_ms > 300000
    OR p_capability IS NULL OR length(p_capability) < 32
    OR length(p_capability) > 512
    OR lower(trim(p_provider)) NOT IN ('baileys', 'wwebjs', 'whatsmeow')
  THEN
    RAISE EXCEPTION 'invalid whatsapp session lease acquisition arguments'
      USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('app.whatsapp_session_id', p_session_id::text, true);
  v_capability_hash := encode(public.digest(p_capability, 'sha256'), 'hex');

  -- Keep lease -> session ordering identical to renew/release/mutations. An
  -- already-running mutation owns FOR SHARE here, so this takeover waits for
  -- that short transaction before advancing the fencing token.
  PERFORM 1
  FROM public.whatsapp_session_lease AS lease
  WHERE lease.session_id = p_session_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'whatsapp session lease row is unavailable'
      USING ERRCODE = '55000';
  END IF;

  PERFORM 1
  FROM public.whatsapp_session AS session
  WHERE session.session_id = p_session_id
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'whatsapp session is unavailable'
      USING ERRCODE = '55000';
  END IF;

  v_now := clock_timestamp();
  v_expires_at := v_now + (p_ttl_ms::text || ' milliseconds')::interval;

  RETURN QUERY
  UPDATE public.whatsapp_session_lease AS lease
  SET owner_id = p_owner_id,
      provider = lower(trim(p_provider)),
      fencing_token = lease.fencing_token + 1,
      generation = p_generation,
      epoch = p_epoch,
      acquired_at = v_now,
      heartbeat_at = v_now,
      expires_at = v_expires_at
  FROM public.whatsapp_session AS session
  WHERE lease.session_id = p_session_id
    AND session.session_id = lease.session_id
    AND session.generation = p_generation
    AND session.epoch = p_epoch
    AND session.capability_hash = v_capability_hash
    AND (
      (
        session.provider = lower(trim(p_provider))
        AND (
          session.state <> 'handoff'
          OR EXISTS (
            SELECT 1
            FROM public.whatsapp_session_handoff AS source_handoff
            WHERE source_handoff.session_id = session.session_id
              AND source_handoff.source_provider = lower(trim(p_provider))
              AND source_handoff.state IN ('requested', 'draining')
          )
        )
      )
      OR (
        session.state = 'handoff'
        AND EXISTS (
          SELECT 1
          FROM public.whatsapp_session_handoff AS target_handoff
          WHERE target_handoff.session_id = session.session_id
            AND target_handoff.target_provider = lower(trim(p_provider))
            AND target_handoff.state IN (
              'transforming', 'hydrating', 'validating', 'promoting'
            )
        )
      )
    )
    AND (
      lease.owner_id IS NULL
      OR lease.expires_at <= v_now
      OR (
        lease.owner_id = p_owner_id
        AND lease.generation = p_generation
        AND lease.epoch = p_epoch
      )
      OR (
        -- Only the strictly newer, already-activated durable session fence may
        -- evict a live owner. A same-generation competitor still waits/fails.
        lease.generation < p_generation
        AND lease.epoch IS DISTINCT FROM p_epoch
        AND session.generation = p_generation
        AND session.epoch = p_epoch
        AND session.capability_hash = v_capability_hash
      )
    )
  RETURNING lease.fencing_token,
    lease.expires_at,
    GREATEST(
      0,
      floor(extract(epoch FROM (lease.expires_at - v_now)) * 1000)
    )::bigint;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'whatsapp session lease is held or session fence is stale'
      USING ERRCODE = '55000';
  END IF;
END;
$function$;
