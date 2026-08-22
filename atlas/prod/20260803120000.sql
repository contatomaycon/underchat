-- Canonical WhatsApp schema v17.
--
-- This is intentionally incremental: v17 distinguishes extractable ADV
-- secrets from signed public companion identity, versions the companion
-- fingerprint, and prevents Signal records from different Web scopes from
-- colliding. Runtime clients must opt in to v17 explicitly.

-- WWebJS crosses its irreversible protocol boundary while Chromium is still
-- offline. Keep that boundary distinct from readiness: `activating` means the
-- provider/revision CAS committed and rollback is forbidden, while
-- `completed` is written only after the connected canonical checkpoint.
ALTER TABLE public.whatsapp_session_handoff
  ADD COLUMN point_of_no_return_at timestamptz,
  ADD COLUMN pre_activation_artifact_id uuid;

ALTER TABLE public.whatsapp_session_handoff
  DROP CONSTRAINT whatsapp_session_handoff_state_check;

ALTER TABLE public.whatsapp_session_handoff
  ADD CONSTRAINT whatsapp_session_handoff_state_check
  CHECK (state IN (
    'requested', 'draining', 'transforming', 'hydrating', 'validating',
    'promoting', 'activating', 'completed', 'failed'
  ));

ALTER TABLE public.whatsapp_session_handoff
  ADD CONSTRAINT whatsapp_session_handoff_activation_boundary_check
  CHECK (
    (
      state = 'activating'
      AND point_of_no_return_at IS NOT NULL
      AND pre_activation_artifact_id IS NOT NULL
    )
    OR state <> 'activating'
  );

-- A worker owns the whole session tree. RESTRICT on the handoff lineage made
-- `worker -> session -> revisions` deletion order-dependent and prevented the
-- promised per-session cascade whenever historical handoffs existed.
ALTER TABLE public.whatsapp_session_handoff
  DROP CONSTRAINT whatsapp_session_handoff_source_revision_fk,
  DROP CONSTRAINT whatsapp_session_handoff_target_revision_fk;

ALTER TABLE public.whatsapp_session_handoff
  ADD CONSTRAINT whatsapp_session_handoff_source_revision_fk
    FOREIGN KEY (session_id, source_revision_id)
    REFERENCES public.whatsapp_session_revision (session_id, revision_id)
    ON DELETE CASCADE,
  ADD CONSTRAINT whatsapp_session_handoff_target_revision_fk
    FOREIGN KEY (session_id, target_revision_id)
    REFERENCES public.whatsapp_session_revision (session_id, revision_id)
    ON DELETE CASCADE;

DROP INDEX public.whatsapp_session_handoff_active_uidx;
CREATE UNIQUE INDEX whatsapp_session_handoff_active_uidx
ON public.whatsapp_session_handoff (session_id)
WHERE state IN (
  'requested', 'draining', 'transforming', 'hydrating', 'validating',
  'promoting', 'activating'
);

ALTER TABLE public.whatsapp_store_version
  DROP CONSTRAINT whatsapp_store_version_single_supported_check;

UPDATE public.whatsapp_store_version
SET version = 17, compat = 17
WHERE version = 16 AND compat = 16;

ALTER TABLE public.whatsapp_store_version
  ADD CONSTRAINT whatsapp_store_version_single_supported_check
  CHECK (version = 17 AND compat = 17);

ALTER TABLE public.whatsapp_session_revision
  DROP CONSTRAINT whatsapp_session_revision_version_check;

UPDATE public.whatsapp_session_revision
SET schema_version = 17
WHERE schema_version = 16;

ALTER TABLE public.whatsapp_session_revision
  ALTER COLUMN schema_version SET DEFAULT 17;

-- Portable ML-KEM material belongs to the canonical revision, never to a
-- provider profile. Keeping one table for both key roles makes key_id unique
-- across one-time and last-resort material. Mutable allocator/server state is
-- kept separately so key rows remain small and append-mostly.
CREATE TABLE "public"."whatsapp_pq_pre_keys" (
  "session_id" uuid NOT NULL,
  "revision_id" bigint NOT NULL,
  "key_id" integer NOT NULL,
  "key_kind" text NOT NULL,
  "public_key" bytea NOT NULL,
  "private_key" bytea NOT NULL,
  "signature" bytea NOT NULL,
  "timestamp_ms" bigint NOT NULL,
  "sent_to_server" boolean NOT NULL DEFAULT false,
  CONSTRAINT "whatsapp_pq_pre_keys_pk" PRIMARY KEY ("session_id", "revision_id", "key_id"),
  CONSTRAINT "whatsapp_pq_pre_keys_device_fk" FOREIGN KEY ("session_id", "revision_id") REFERENCES "public"."whatsapp_device" ("session_id", "revision_id") ON DELETE CASCADE,
  CONSTRAINT "whatsapp_pq_pre_keys_key_id_check" CHECK (
    key_id >= 0 AND key_id < 16777215
  ),
  CONSTRAINT "whatsapp_pq_pre_keys_kind_check" CHECK (
    key_kind IN ('one_time', 'last_resort')
  ),
  CONSTRAINT "whatsapp_pq_pre_keys_public_key_check" CHECK (
    octet_length(public_key) = 1568
  ),
  CONSTRAINT "whatsapp_pq_pre_keys_private_key_check" CHECK (
    octet_length(private_key) = 3168
  ),
  CONSTRAINT "whatsapp_pq_pre_keys_signature_check" CHECK (
    octet_length(signature) = 64
  ),
  CONSTRAINT "whatsapp_pq_pre_keys_timestamp_check" CHECK (
    timestamp_ms >= 0
  )
) WITH (fillfactor = 80);

CREATE UNIQUE INDEX "whatsapp_pq_pre_keys_last_resort_uidx"
ON "public"."whatsapp_pq_pre_keys" ("session_id", "revision_id")
WHERE (key_kind = 'last_resort');

CREATE INDEX "whatsapp_pq_pre_keys_pending_idx"
ON "public"."whatsapp_pq_pre_keys" (
  "session_id", "revision_id", "key_id"
)
WHERE (key_kind = 'one_time' AND sent_to_server = false);

CREATE TABLE "public"."whatsapp_pq_pre_key_state" (
  "session_id" uuid NOT NULL,
  "revision_id" bigint NOT NULL,
  "codec_version" integer NOT NULL DEFAULT 1,
  "algorithm" text NOT NULL DEFAULT 'ML-KEM-1024',
  "next_pre_key_id" integer NOT NULL DEFAULT 1,
  "migrated" boolean NOT NULL DEFAULT false,
  "last_server_count" integer NULL,
  "last_server_count_timestamp_ms" bigint NULL,
  CONSTRAINT "whatsapp_pq_pre_key_state_pk" PRIMARY KEY ("session_id", "revision_id"),
  CONSTRAINT "whatsapp_pq_pre_key_state_device_fk" FOREIGN KEY ("session_id", "revision_id") REFERENCES "public"."whatsapp_device" ("session_id", "revision_id") ON DELETE CASCADE,
  CONSTRAINT "whatsapp_pq_pre_key_state_codec_check" CHECK (
    codec_version = 1 AND algorithm = 'ML-KEM-1024'
  ),
  CONSTRAINT "whatsapp_pq_pre_key_state_allocator_check" CHECK (
    next_pre_key_id >= 0 AND next_pre_key_id < 16777215
  ),
  CONSTRAINT "whatsapp_pq_pre_key_state_server_count_check" CHECK (
    (
      last_server_count IS NULL
      AND last_server_count_timestamp_ms IS NULL
    ) OR (
      last_server_count IS NOT NULL
      AND last_server_count_timestamp_ms IS NOT NULL
      AND last_server_count >= 0
      AND last_server_count_timestamp_ms >= 0
    )
  )
) WITH (fillfactor = 80);

ALTER TABLE public.whatsapp_pq_pre_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_pq_pre_keys FORCE ROW LEVEL SECURITY;
CREATE POLICY whatsapp_session_revision_isolation
ON public.whatsapp_pq_pre_keys
USING (
  session_id = (
    SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid
  )
  AND revision_id = (
    SELECT nullif(current_setting('app.whatsapp_revision_id', true), '')::bigint
  )
  AND (SELECT public.whatsapp_runtime_scope_is_valid())
)
WITH CHECK (
  session_id = (
    SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid
  )
  AND revision_id = (
    SELECT nullif(current_setting('app.whatsapp_revision_id', true), '')::bigint
  )
  AND (SELECT public.whatsapp_runtime_scope_is_valid())
);

ALTER TABLE public.whatsapp_pq_pre_key_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_pq_pre_key_state FORCE ROW LEVEL SECURITY;
CREATE POLICY whatsapp_session_revision_isolation
ON public.whatsapp_pq_pre_key_state
USING (
  session_id = (
    SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid
  )
  AND revision_id = (
    SELECT nullif(current_setting('app.whatsapp_revision_id', true), '')::bigint
  )
  AND (SELECT public.whatsapp_runtime_scope_is_valid())
)
WITH CHECK (
  session_id = (
    SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid
  )
  AND revision_id = (
    SELECT nullif(current_setting('app.whatsapp_revision_id', true), '')::bigint
  )
  AND (SELECT public.whatsapp_runtime_scope_is_valid())
);

REVOKE ALL ON TABLE public.whatsapp_pq_pre_keys FROM PUBLIC;
REVOKE ALL ON TABLE public.whatsapp_pq_pre_key_state FROM PUBLIC;
REVOKE ALL ON TABLE public.whatsapp_pq_pre_keys
FROM whatsapp_session_runtime;
REVOKE ALL ON TABLE public.whatsapp_pq_pre_key_state
FROM whatsapp_session_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.whatsapp_pq_pre_keys,
  public.whatsapp_pq_pre_key_state
TO whatsapp_session_runtime;

-- v17 makes the lease row permanent and samples PostgreSQL time only after
-- waiting for its exclusive lock. The v16 acquire/renew functions sampled at
-- function entry, so a wait behind begin_whatsapp_session_operation's
-- FOR SHARE lock could renew an already-expired writer or return a stale TTL.
INSERT INTO public.whatsapp_session_lease (session_id, generation)
SELECT session.session_id, session.generation
FROM public.whatsapp_session AS session
ON CONFLICT (session_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.create_whatsapp_session_lease_row_v17()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  INSERT INTO public.whatsapp_session_lease (session_id, generation)
  VALUES (NEW.session_id, NEW.generation)
  ON CONFLICT (session_id) DO NOTHING;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_whatsapp_session_lease_row_v17()
FROM PUBLIC;

CREATE TRIGGER whatsapp_session_create_lease_row_v17_trigger
AFTER INSERT ON public.whatsapp_session
FOR EACH ROW EXECUTE FUNCTION public.create_whatsapp_session_lease_row_v17();

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

  -- Always preserve lease -> session lock order. Time spent waiting behind a
  -- protocol transaction counts against the old lease, not the new TTL.
  PERFORM 1
  FROM public.whatsapp_session_lease AS lease
  WHERE lease.session_id = p_session_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'whatsapp session lease row is unavailable'
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

CREATE OR REPLACE FUNCTION public.renew_whatsapp_session_lease(
  p_session_id uuid,
  p_owner_id uuid,
  p_provider text,
  p_fencing_token bigint,
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
    OR p_fencing_token <= 0 OR p_generation <= 0
    OR p_ttl_ms < 5000 OR p_ttl_ms > 300000
    OR p_capability IS NULL OR length(p_capability) < 32
    OR length(p_capability) > 512
    OR lower(trim(p_provider)) NOT IN ('baileys', 'wwebjs', 'whatsmeow')
  THEN
    RAISE EXCEPTION 'invalid whatsapp session lease renewal arguments'
      USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('app.whatsapp_session_id', p_session_id::text, true);
  v_capability_hash := encode(public.digest(p_capability, 'sha256'), 'hex');

  PERFORM 1
  FROM public.whatsapp_session_lease AS lease
  WHERE lease.session_id = p_session_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'whatsapp session lease was lost'
      USING ERRCODE = '55000';
  END IF;

  v_now := clock_timestamp();
  v_expires_at := v_now + (p_ttl_ms::text || ' milliseconds')::interval;

  RETURN QUERY
  UPDATE public.whatsapp_session_lease AS lease
  SET heartbeat_at = v_now,
      expires_at = v_expires_at
  FROM public.whatsapp_session AS session
  WHERE lease.session_id = p_session_id
    AND session.session_id = lease.session_id
    AND lease.owner_id = p_owner_id
    AND lease.provider = lower(trim(p_provider))
    AND lease.fencing_token = p_fencing_token
    AND lease.generation = p_generation
    AND lease.epoch = p_epoch
    AND lease.expires_at > v_now
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
  RETURNING lease.fencing_token,
    lease.expires_at,
    GREATEST(
      0,
      floor(extract(epoch FROM (lease.expires_at - v_now)) * 1000)
    )::bigint;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'whatsapp session lease was lost'
      USING ERRCODE = '55000';
  END IF;
END;
$function$;

-- Reads keep using begin_whatsapp_session_operation and therefore hold only
-- shared locks. Every direct runtime DML transaction must enter through this
-- mutation variant. The fixed lease -> session -> revision order prevents a
-- takeover from crossing an in-flight write and matches the lifecycle APIs.
CREATE OR REPLACE FUNCTION public.begin_whatsapp_session_mutation(
  p_session_id uuid,
  p_revision_id bigint,
  p_owner_id uuid,
  p_fencing_token bigint,
  p_generation integer,
  p_epoch uuid,
  p_capability text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_provider text;
  v_capability_hash text;
  v_session_state text;
  v_active_revision_id bigint;
BEGIN
  IF p_session_id IS NULL OR p_revision_id IS NULL OR p_owner_id IS NULL
    OR p_epoch IS NULL OR p_fencing_token <= 0 OR p_generation <= 0
    OR p_capability IS NULL OR length(p_capability) < 32
    OR length(p_capability) > 512
  THEN
    RAISE EXCEPTION 'invalid whatsapp session mutation arguments'
      USING ERRCODE = '22023';
  END IF;

  v_capability_hash := encode(public.digest(p_capability, 'sha256'), 'hex');
  -- These values are transaction-local. FORCE RLS accepts them only after the
  -- complete capability/fence validation below mints the database signature.
  PERFORM set_config('app.whatsapp_session_id', p_session_id::text, true);
  PERFORM set_config('app.whatsapp_revision_id', p_revision_id::text, true);

  -- Lock 1/3: keep takeover/renew behind the complete mutation transaction.
  SELECT lease.provider
  INTO v_provider
  FROM public.whatsapp_session_lease AS lease
  WHERE lease.session_id = p_session_id
    AND lease.owner_id = p_owner_id
    AND lease.fencing_token = p_fencing_token
    AND lease.generation = p_generation
    AND lease.epoch = p_epoch
    AND lease.expires_at > clock_timestamp()
  FOR SHARE OF lease;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stale or unauthorized whatsapp session mutation'
      USING ERRCODE = '55000';
  END IF;

  -- Lock 2/3: serialize direct state writes with lifecycle header changes.
  SELECT session.state, session.active_revision_id
  INTO v_session_state, v_active_revision_id
  FROM public.whatsapp_session AS session
  WHERE session.session_id = p_session_id
    AND session.generation = p_generation
    AND session.epoch = p_epoch
    AND session.capability_hash = v_capability_hash
  FOR UPDATE OF session;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stale or unauthorized whatsapp session mutation'
      USING ERRCODE = '55000';
  END IF;

  -- Lock 3/3: authorize and pin the exact writable projection.
  PERFORM 1
  FROM public.whatsapp_session_revision AS revision
  WHERE revision.session_id = p_session_id
    AND revision.revision_id = p_revision_id
    AND revision.provider = v_provider
    AND revision.writer_generation = p_generation
    AND revision.writer_epoch = p_epoch
    AND revision.capability_hash = v_capability_hash
    AND revision.status IN ('staging', 'validating', 'active')
    AND (
      (
        v_session_state <> 'handoff'
        AND v_active_revision_id = revision.revision_id
      )
      OR (
        v_session_state = 'handoff'
        AND v_active_revision_id = revision.revision_id
        AND EXISTS (
          SELECT 1
          FROM public.whatsapp_session_handoff AS source_handoff
          WHERE source_handoff.session_id = p_session_id
            AND source_handoff.source_revision_id = revision.revision_id
            AND source_handoff.source_provider = v_provider
            AND source_handoff.state IN ('requested', 'draining')
        )
      )
      OR EXISTS (
        SELECT 1
        FROM public.whatsapp_session_handoff AS target_handoff
        WHERE target_handoff.session_id = p_session_id
          AND target_handoff.target_revision_id = revision.revision_id
          AND target_handoff.target_provider = v_provider
          AND target_handoff.state IN (
            'transforming', 'hydrating', 'validating', 'promoting'
          )
      )
      OR (
        v_session_state <> 'handoff'
        AND v_active_revision_id IS NULL
        AND revision.status = 'staging'
      )
    )
  FOR UPDATE OF revision;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stale or unauthorized whatsapp session mutation'
      USING ERRCODE = '55000';
  END IF;

  PERFORM set_config('app.whatsapp_fencing_token', p_fencing_token::text, true);
  PERFORM set_config('app.whatsapp_owner_id', p_owner_id::text, true);
  PERFORM set_config('app.whatsapp_generation', p_generation::text, true);
  PERFORM set_config('app.whatsapp_epoch', p_epoch::text, true);
  PERFORM set_config('app.whatsapp_capability', p_capability, true);
  PERFORM set_config('app.whatsapp_lease_provider', v_provider, true);
  PERFORM set_config('app.whatsapp_provider', v_provider, true);
  PERFORM public.issue_whatsapp_runtime_scope_signature();
  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.begin_whatsapp_session_mutation(
  uuid, bigint, uuid, bigint, integer, uuid, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.begin_whatsapp_session_mutation(
  uuid, bigint, uuid, bigint, integer, uuid, text
) TO whatsapp_session_runtime;

-- Artifact blobs are revision-invisible until an artifact chunk references
-- them. Direct INSERT ... ON CONFLICT cannot safely deduplicate such a row:
-- PostgreSQL must resolve the hidden conflict through RLS and rejects it.
-- Keep payload reads revision-scoped and expose only these capability-fenced,
-- write-only batch helpers to the runtime role.
CREATE OR REPLACE FUNCTION public.put_whatsapp_artifact_blobs(
  p_session_id uuid,
  p_sha256 text[],
  p_payload bytea[],
  p_size_bytes integer[]
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_count integer;
  v_index integer;
  v_total_bytes bigint := 0;
  v_sha256 text;
  v_payload bytea;
  v_size_bytes integer;
BEGIN
  IF p_session_id IS NULL
    OR p_session_id IS DISTINCT FROM nullif(
      current_setting('app.whatsapp_session_id', true), ''
    )::uuid
    OR NOT public.whatsapp_runtime_scope_is_valid()
  THEN
    RAISE EXCEPTION 'stale or unauthorized whatsapp artifact upload'
      USING ERRCODE = '55000';
  END IF;

  IF p_sha256 IS NULL OR p_payload IS NULL OR p_size_bytes IS NULL
    OR array_ndims(p_sha256) IS DISTINCT FROM 1
    OR array_ndims(p_payload) IS DISTINCT FROM 1
    OR array_ndims(p_size_bytes) IS DISTINCT FROM 1
    OR array_lower(p_sha256, 1) IS DISTINCT FROM 1
    OR array_lower(p_payload, 1) IS DISTINCT FROM 1
    OR array_lower(p_size_bytes, 1) IS DISTINCT FROM 1
  THEN
    RAISE EXCEPTION 'invalid whatsapp artifact blob arrays'
      USING ERRCODE = '22023';
  END IF;

  v_count := cardinality(p_sha256);
  IF v_count NOT BETWEEN 1 AND 16
    OR cardinality(p_payload) <> v_count
    OR cardinality(p_size_bytes) <> v_count
  THEN
    RAISE EXCEPTION 'invalid whatsapp artifact blob batch size'
      USING ERRCODE = '22023';
  END IF;

  FOR v_index IN 1..v_count LOOP
    v_sha256 := p_sha256[v_index];
    v_payload := p_payload[v_index];
    v_size_bytes := p_size_bytes[v_index];
    IF v_sha256 IS NULL OR v_sha256 !~ '^[0-9a-f]{64}$'
      OR v_payload IS NULL OR v_size_bytes IS NULL
      OR v_size_bytes < 1 OR v_size_bytes > 1048576
      OR octet_length(v_payload) <> v_size_bytes
      OR encode(public.digest(v_payload, 'sha256'), 'hex')
        IS DISTINCT FROM v_sha256
    THEN
      RAISE EXCEPTION 'invalid whatsapp artifact blob payload'
        USING ERRCODE = '22023';
    END IF;
    v_total_bytes := v_total_bytes + v_size_bytes;
    IF v_total_bytes > 16777216 THEN
      RAISE EXCEPTION 'whatsapp artifact blob batch exceeds byte cap'
        USING ERRCODE = '22023';
    END IF;
  END LOOP;

  FOR v_index IN 1..v_count LOOP
    INSERT INTO public.whatsapp_artifact_blob (
      session_id, sha256, payload, size_bytes, created_at
    ) VALUES (
      p_session_id, p_sha256[v_index], p_payload[v_index],
      p_size_bytes[v_index], clock_timestamp()
    )
    ON CONFLICT (session_id, sha256) DO NOTHING;
  END LOOP;
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.prune_whatsapp_orphan_artifact_blobs(
  p_session_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF p_session_id IS NULL
    OR p_session_id IS DISTINCT FROM nullif(
      current_setting('app.whatsapp_session_id', true), ''
    )::uuid
    OR NOT public.whatsapp_runtime_scope_is_valid()
  THEN
    RAISE EXCEPTION 'stale or unauthorized whatsapp artifact prune'
      USING ERRCODE = '55000';
  END IF;

  DELETE FROM public.whatsapp_artifact_blob AS blob
  WHERE blob.session_id = p_session_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.whatsapp_artifact_chunk AS chunk
      WHERE chunk.session_id = blob.session_id
        AND chunk.sha256 = blob.sha256
    );
  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.put_whatsapp_artifact_blobs(
  uuid, text[], bytea[], integer[]
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.put_whatsapp_artifact_blobs(
  uuid, text[], bytea[], integer[]
) TO whatsapp_session_runtime;
REVOKE ALL ON FUNCTION public.prune_whatsapp_orphan_artifact_blobs(uuid)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prune_whatsapp_orphan_artifact_blobs(uuid)
TO whatsapp_session_runtime;

-- Lifecycle functions installed by v16 performed DML after acquiring only
-- shared session/revision locks. Keep their signatures and behavior intact,
-- but route their exact writable revision through the v17 mutation boundary.
CREATE OR REPLACE FUNCTION public.finalize_whatsapp_session_pairing(p_session_id uuid, p_revision_id bigint, p_owner_id uuid, p_fencing_token bigint, p_generation integer, p_epoch uuid, p_capability text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_provider text;
  v_device_fingerprint bytea;
  v_device_jid text;
  v_checksum text;
BEGIN
  PERFORM public.begin_whatsapp_session_mutation(
    p_session_id, p_revision_id, p_owner_id, p_fencing_token,
    p_generation, p_epoch, p_capability
  );

  SELECT revision.provider, device.device_fingerprint, device.jid
  INTO v_provider, v_device_fingerprint, v_device_jid
  FROM public.whatsapp_session_revision AS revision
  JOIN public.whatsapp_device AS device
    ON device.session_id = revision.session_id
   AND device.revision_id = revision.revision_id
  WHERE revision.session_id = p_session_id
    AND revision.revision_id = p_revision_id
    AND revision.status IN ('staging', 'validating', 'active')
    AND device.jid IS NOT NULL
    AND device.device_fingerprint IS NOT NULL
    AND (
      (
        revision.provider IN ('baileys', 'whatsmeow')
        AND device.registration_id IS NOT NULL
        AND device.noise_key IS NOT NULL
        AND device.identity_key IS NOT NULL
        AND device.signed_pre_key IS NOT NULL
        AND device.signed_pre_key_sig IS NOT NULL
      )
      OR (
        revision.provider = 'wwebjs'
        AND EXISTS (
          SELECT 1
          FROM public.whatsapp_artifact AS artifact
          WHERE artifact.session_id = revision.session_id
            AND artifact.revision_id = revision.revision_id
            AND artifact.provider = 'wwebjs'
            AND artifact.status = 'ready'
        )
      )
    )
  FOR UPDATE OF revision, device;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'paired whatsapp session identity is incomplete'
      USING ERRCODE = '23514';
  END IF;

  v_checksum := encode(
    public.digest(convert_to(v_device_jid, 'UTF8') || v_device_fingerprint, 'sha256'),
    'hex'
  );
  UPDATE public.whatsapp_session_revision
  SET status = 'active',
      checksum_sha256 = COALESCE(checksum_sha256, v_checksum),
      persisted_at = COALESCE(persisted_at, clock_timestamp()),
      validated_at = COALESCE(validated_at, clock_timestamp()),
      promoted_at = COALESCE(promoted_at, clock_timestamp())
  WHERE session_id = p_session_id
    AND revision_id = p_revision_id;

  UPDATE public.whatsapp_session
  SET state = 'ready',
      active_device_fingerprint = v_device_fingerprint,
      last_persisted_at = clock_timestamp(),
      last_error_at = NULL,
      updated_at = clock_timestamp()
  WHERE session_id = p_session_id
    AND active_revision_id = p_revision_id
    AND provider = v_provider
    AND generation = p_generation
    AND epoch = p_epoch;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'whatsapp session changed during pairing finalization'
      USING ERRCODE = '40001';
  END IF;
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.promote_whatsapp_session_revision(p_session_id uuid, p_expected_active_revision_id bigint, p_target_revision_id bigint, p_owner_id uuid, p_fencing_token bigint, p_generation integer, p_epoch uuid, p_capability text, p_expected_jid text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_source_provider text;
  v_target_provider text;
  v_target_source text;
  v_lifecycle_operation_id uuid;
  v_source_worker_type uuid;
  v_target_worker_type uuid;
  v_device_fingerprint bytea;
  v_device_jid text;
  v_source_fingerprint bytea;
  v_source_jid text;
BEGIN
  PERFORM set_config('app.whatsapp_session_id', p_session_id::text, true);
  -- Worker remains source-authoritative until this transaction commits. Lock
  -- it before the session graph to keep the control-plane lock order stable.
  PERFORM 1
  FROM public.worker AS worker
  WHERE worker.worker_id = p_session_id
    AND worker.session_storage = 'postgres'
    AND worker.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'whatsapp worker is unavailable for promotion'
      USING ERRCODE = '55000';
  END IF;

  PERFORM public.begin_whatsapp_session_mutation(
    p_session_id,
    p_target_revision_id,
    p_owner_id,
    p_fencing_token,
    p_generation,
    p_epoch,
    p_capability
  );

  -- Serialize the exact handoff before touching either revision. This closes
  -- the race where another connection could fail/rollback the handoff after
  -- the lease check but before the header promotion.
  -- Idempotent retry after a committed promotion whose response was lost.
  IF EXISTS (
    SELECT 1
    FROM public.whatsapp_session AS session
    JOIN public.whatsapp_session_handoff AS handoff
      ON handoff.session_id = session.session_id
     AND handoff.source_revision_id = p_expected_active_revision_id
     AND handoff.target_revision_id = p_target_revision_id
    JOIN public.worker AS worker
      ON worker.worker_id = session.session_id
    WHERE session.session_id = p_session_id
      AND session.active_revision_id = p_target_revision_id
      AND session.provider = handoff.target_provider
      AND session.state = 'ready'
      AND handoff.state = 'completed'
      AND worker.worker_type_id = CASE handoff.target_provider
        WHEN 'baileys' THEN '019a930d-c6f6-766d-9c84-53307d4159a1'::uuid
        WHEN 'wwebjs' THEN '019a930d-c6f6-766d-9c84-62b9c3e7d1f0'::uuid
        WHEN 'whatsmeow' THEN 'e80ad183-2b46-4628-9105-a036f2d28720'::uuid
      END
  ) THEN
    RETURN true;
  END IF;

  SELECT handoff.source_provider, target_revision.provider,
    target_revision.source, handoff.lifecycle_operation_id
  INTO v_source_provider, v_target_provider, v_target_source,
    v_lifecycle_operation_id
  FROM public.whatsapp_session AS session
  JOIN public.whatsapp_session_handoff AS handoff
    ON handoff.session_id = session.session_id
   AND handoff.source_revision_id = p_expected_active_revision_id
   AND handoff.target_revision_id = p_target_revision_id
  JOIN public.whatsapp_session_revision AS source_revision
    ON source_revision.session_id = handoff.session_id
   AND source_revision.revision_id = handoff.source_revision_id
  JOIN public.whatsapp_session_revision AS target_revision
    ON target_revision.session_id = handoff.session_id
   AND target_revision.revision_id = handoff.target_revision_id
  WHERE session.session_id = p_session_id
    AND session.active_revision_id = p_expected_active_revision_id
    AND session.provider = handoff.source_provider
    AND source_revision.provider = handoff.source_provider
    AND target_revision.provider = handoff.target_provider
    AND handoff.state IN (
      'transforming', 'hydrating', 'validating', 'promoting'
    )
  FOR UPDATE OF handoff;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'whatsapp session promotion handoff changed'
      USING ERRCODE = '40001';
  END IF;

  v_source_worker_type := CASE v_source_provider
    WHEN 'baileys' THEN '019a930d-c6f6-766d-9c84-53307d4159a1'::uuid
    WHEN 'wwebjs' THEN '019a930d-c6f6-766d-9c84-62b9c3e7d1f0'::uuid
    WHEN 'whatsmeow' THEN 'e80ad183-2b46-4628-9105-a036f2d28720'::uuid
  END;
  v_target_worker_type := CASE v_target_provider
    WHEN 'baileys' THEN '019a930d-c6f6-766d-9c84-53307d4159a1'::uuid
    WHEN 'wwebjs' THEN '019a930d-c6f6-766d-9c84-62b9c3e7d1f0'::uuid
    WHEN 'whatsmeow' THEN 'e80ad183-2b46-4628-9105-a036f2d28720'::uuid
  END;

  SELECT revision.provider, device.device_fingerprint, device.jid
  INTO v_target_provider, v_device_fingerprint, v_device_jid
  FROM public.whatsapp_session_revision AS revision
  JOIN public.whatsapp_device AS device
    ON device.session_id = revision.session_id
   AND device.revision_id = revision.revision_id
  WHERE revision.session_id = p_session_id
    AND revision.revision_id = p_target_revision_id
    AND revision.provider = v_target_provider
    AND revision.status IN ('staging', 'validating')
    AND revision.checksum_sha256 IS NOT NULL
    AND device.jid IS NOT NULL
    AND device.device_fingerprint IS NOT NULL
    AND (
      (
        revision.provider IN ('baileys', 'whatsmeow')
        AND device.registration_id IS NOT NULL
        AND device.noise_key IS NOT NULL
        AND device.identity_key IS NOT NULL
        AND device.signed_pre_key IS NOT NULL
        AND device.signed_pre_key_sig IS NOT NULL
      )
      OR (
        revision.provider = 'wwebjs'
        AND EXISTS (
          SELECT 1
          FROM public.whatsapp_artifact AS artifact
          WHERE artifact.session_id = revision.session_id
            AND artifact.revision_id = revision.revision_id
            AND artifact.provider = 'wwebjs'
            AND artifact.status = 'ready'
        )
      )
    )
  FOR UPDATE OF revision, device;

  IF NOT FOUND OR (
    p_expected_jid IS NOT NULL
    AND public.normalize_whatsapp_companion_jid(v_device_jid)
      <> public.normalize_whatsapp_companion_jid(p_expected_jid)
  ) THEN
    RAISE EXCEPTION 'candidate whatsapp session identity is incomplete or mismatched'
      USING ERRCODE = '23514';
  END IF;

  SELECT source_device.device_fingerprint, source_device.jid
  INTO v_source_fingerprint, v_source_jid
  FROM public.whatsapp_session AS session
  JOIN public.whatsapp_session_revision AS source_revision
    ON source_revision.session_id = session.session_id
   AND source_revision.revision_id = session.active_revision_id
  JOIN public.whatsapp_device AS source_device
    ON source_device.session_id = source_revision.session_id
   AND source_device.revision_id = source_revision.revision_id
  WHERE session.session_id = p_session_id
    AND session.active_revision_id = p_expected_active_revision_id
    AND source_revision.status IN ('staging', 'validating', 'active')
    AND source_device.jid IS NOT NULL
    AND source_device.device_fingerprint IS NOT NULL
  FOR SHARE OF source_revision, source_device;
  IF NOT FOUND
    OR public.normalize_whatsapp_companion_jid(v_device_jid)
      IS DISTINCT FROM public.normalize_whatsapp_companion_jid(v_source_jid)
    OR v_device_fingerprint IS DISTINCT FROM v_source_fingerprint
  THEN
    RAISE EXCEPTION 'candidate whatsapp session changed companion identity'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.whatsapp_session_revision
  SET status = 'retired', retired_at = clock_timestamp()
  WHERE session_id = p_session_id
    AND revision_id = p_expected_active_revision_id
    AND status IN ('staging', 'validating', 'active');

  IF p_expected_active_revision_id IS NOT NULL AND NOT FOUND THEN
    RAISE EXCEPTION 'active whatsapp session revision changed during promotion'
      USING ERRCODE = '40001';
  END IF;

  UPDATE public.whatsapp_session_revision
  SET status = 'active',
      validated_at = COALESCE(validated_at, clock_timestamp()),
      promoted_at = clock_timestamp()
  WHERE session_id = p_session_id
    AND revision_id = p_target_revision_id
    AND status IN ('staging', 'validating');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'candidate whatsapp session revision is no longer promotable'
      USING ERRCODE = '40001';
  END IF;

  UPDATE public.whatsapp_session
  SET provider = v_target_provider,
      state = 'ready',
      previous_revision_id = p_expected_active_revision_id,
      active_revision_id = p_target_revision_id,
      active_device_fingerprint = v_device_fingerprint,
      last_persisted_at = clock_timestamp(),
      updated_at = clock_timestamp()
  WHERE session_id = p_session_id
    AND active_revision_id IS NOT DISTINCT FROM p_expected_active_revision_id
    AND generation = p_generation
    AND epoch = p_epoch;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'whatsapp session header changed during promotion'
      USING ERRCODE = '40001';
  END IF;

  IF v_source_provider = v_target_provider
    AND v_target_source = 'secure_import'
    AND v_lifecycle_operation_id IS NULL
  THEN
    -- Same-provider secure import replaces only the canonical projection. It
    -- is not a channel-type lifecycle operation and must not require or
    -- mutate worker lifecycle metadata. The worker row is already locked;
    -- revalidate that its provider type and PostgreSQL ownership stayed put.
    PERFORM 1
    FROM public.worker AS worker
    WHERE worker.worker_id = p_session_id
      AND worker.worker_type_id = v_source_worker_type
      AND worker.session_storage = 'postgres'
      AND worker.deleted_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'worker provider changed during whatsapp secure import promotion'
        USING ERRCODE = '40001';
    END IF;
  ELSE
    UPDATE public.worker AS worker
    SET worker_type_id = v_target_worker_type,
        updated_at = clock_timestamp()
    WHERE worker.worker_id = p_session_id
      AND worker.worker_type_id = v_source_worker_type
      AND worker.worker_status_id = '019a930d-c6f6-766d-9c84-46093814d8e0'::uuid
      AND worker.lifecycle_operation_id = v_lifecycle_operation_id
      AND worker.session_storage = 'postgres'
      AND worker.deleted_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'worker provider changed during whatsapp session promotion'
        USING ERRCODE = '40001';
    END IF;
  END IF;

  UPDATE public.whatsapp_session_handoff
  SET state = 'completed', updated_at = clock_timestamp(), completed_at = clock_timestamp()
  WHERE session_id = p_session_id
    AND source_revision_id = p_expected_active_revision_id
    AND target_revision_id = p_target_revision_id
    AND source_provider = (
      SELECT source_revision.provider
      FROM public.whatsapp_session_revision AS source_revision
      WHERE source_revision.session_id = p_session_id
        AND source_revision.revision_id = p_expected_active_revision_id
    )
    AND target_provider = v_target_provider
    AND state IN ('transforming', 'hydrating', 'validating', 'promoting');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'whatsapp session handoff changed before completion'
      USING ERRCODE = '40001';
  END IF;
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rollback_whatsapp_session_revision(p_session_id uuid, p_candidate_revision_id bigint, p_previous_revision_id bigint, p_owner_id uuid, p_fencing_token bigint, p_generation integer, p_epoch uuid, p_capability text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_source_provider text;
  v_target_provider text;
  v_target_source text;
  v_lifecycle_operation_id uuid;
  v_source_worker_type uuid;
  v_target_worker_type uuid;
  v_previous_provider text;
  v_previous_status text;
  v_previous_fingerprint bytea;
  v_previous_jid text;
BEGIN
  IF p_candidate_revision_id IS NULL OR p_previous_revision_id IS NULL
    OR p_candidate_revision_id = p_previous_revision_id
  THEN
    RAISE EXCEPTION 'invalid whatsapp session rollback revisions'
      USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('app.whatsapp_session_id', p_session_id::text, true);
  PERFORM 1
  FROM public.worker AS worker
  WHERE worker.worker_id = p_session_id
    AND worker.session_storage = 'postgres'
    AND worker.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'whatsapp worker is unavailable for rollback'
      USING ERRCODE = '55000';
  END IF;

  PERFORM public.begin_whatsapp_session_mutation(
    p_session_id,
    p_candidate_revision_id,
    p_owner_id,
    p_fencing_token,
    p_generation,
    p_epoch,
    p_capability
  );

  SELECT handoff.source_provider, handoff.target_provider,
    target_revision.source, handoff.lifecycle_operation_id
  INTO v_source_provider, v_target_provider, v_target_source,
    v_lifecycle_operation_id
  FROM public.whatsapp_session_handoff AS handoff
  JOIN public.whatsapp_session_revision AS target_revision
    ON target_revision.session_id = handoff.session_id
   AND target_revision.revision_id = handoff.target_revision_id
   AND target_revision.provider = handoff.target_provider
  WHERE handoff.session_id = p_session_id
    AND handoff.source_revision_id = p_previous_revision_id
    AND handoff.target_revision_id = p_candidate_revision_id
    AND handoff.state IN (
      'requested', 'draining', 'transforming', 'hydrating',
      'validating', 'promoting'
    )
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'whatsapp session rollback association is invalid'
      USING ERRCODE = '55000';
  END IF;

  v_source_worker_type := CASE v_source_provider
    WHEN 'baileys' THEN '019a930d-c6f6-766d-9c84-53307d4159a1'::uuid
    WHEN 'wwebjs' THEN '019a930d-c6f6-766d-9c84-62b9c3e7d1f0'::uuid
    WHEN 'whatsmeow' THEN 'e80ad183-2b46-4628-9105-a036f2d28720'::uuid
  END;
  v_target_worker_type := CASE v_target_provider
    WHEN 'baileys' THEN '019a930d-c6f6-766d-9c84-53307d4159a1'::uuid
    WHEN 'wwebjs' THEN '019a930d-c6f6-766d-9c84-62b9c3e7d1f0'::uuid
    WHEN 'whatsmeow' THEN 'e80ad183-2b46-4628-9105-a036f2d28720'::uuid
  END;

  UPDATE public.whatsapp_session_revision
  SET status = 'failed',
      error_code = COALESCE(error_code, 'handoff_rolled_back'),
      retired_at = clock_timestamp()
  WHERE session_id = p_session_id
    AND revision_id = p_candidate_revision_id
    AND status IN ('staging', 'validating');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'candidate whatsapp session revision is not rollbackable'
      USING ERRCODE = '40001';
  END IF;

  PERFORM set_config('app.whatsapp_revision_id', p_previous_revision_id::text, true);
  SELECT revision.provider, revision.status, device.device_fingerprint, device.jid
  INTO v_previous_provider, v_previous_status, v_previous_fingerprint, v_previous_jid
  FROM public.whatsapp_session_revision AS revision
  LEFT JOIN public.whatsapp_device AS device
    ON device.session_id = revision.session_id
   AND device.revision_id = revision.revision_id
  WHERE revision.session_id = p_session_id
    AND revision.revision_id = p_previous_revision_id
    AND revision.status IN ('staging', 'validating', 'active', 'retired')
  FOR UPDATE OF revision;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'previous whatsapp session revision is unavailable'
      USING ERRCODE = '55000';
  END IF;

  UPDATE public.whatsapp_session_revision
  SET status = CASE
        WHEN v_previous_jid IS NOT NULL AND v_previous_fingerprint IS NOT NULL
          THEN 'active'
        WHEN v_previous_status = 'retired' THEN 'validating'
        ELSE v_previous_status
      END,
      error_code = NULL,
      retired_at = NULL,
      promoted_at = CASE
        WHEN v_previous_jid IS NOT NULL AND v_previous_fingerprint IS NOT NULL
          THEN COALESCE(promoted_at, clock_timestamp())
        ELSE promoted_at
      END
  WHERE session_id = p_session_id
    AND revision_id = p_previous_revision_id;

  UPDATE public.whatsapp_session
  SET provider = v_previous_provider,
      state = CASE
        WHEN v_previous_jid IS NOT NULL AND v_previous_fingerprint IS NOT NULL
          THEN 'ready'
        ELSE 'preparing'
      END,
      active_revision_id = p_previous_revision_id,
      previous_revision_id = NULL,
      active_device_fingerprint = v_previous_fingerprint,
      last_error_at = clock_timestamp(),
      updated_at = clock_timestamp()
  WHERE session_id = p_session_id
    AND generation = p_generation
    AND epoch = p_epoch
    AND active_revision_id = p_previous_revision_id
    AND previous_revision_id IS DISTINCT FROM p_candidate_revision_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'whatsapp session changed during rollback'
      USING ERRCODE = '40001';
  END IF;

  IF v_source_provider = v_target_provider
    AND v_target_source = 'secure_import'
    AND v_lifecycle_operation_id IS NULL
  THEN
    PERFORM 1
    FROM public.worker AS worker
    WHERE worker.worker_id = p_session_id
      AND worker.worker_type_id = v_source_worker_type
      AND worker.session_storage = 'postgres'
      AND worker.deleted_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'worker provider changed during whatsapp secure import rollback'
        USING ERRCODE = '40001';
    END IF;
  ELSE
    UPDATE public.worker AS worker
    SET worker_type_id = v_source_worker_type,
        updated_at = clock_timestamp()
    WHERE worker.worker_id = p_session_id
      AND worker.worker_type_id = v_source_worker_type
      AND worker.worker_status_id = '019a930d-c6f6-766d-9c84-46093814d8e0'::uuid
      AND worker.lifecycle_operation_id = v_lifecycle_operation_id
      AND worker.session_storage = 'postgres'
      AND worker.deleted_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'worker lifecycle changed during whatsapp session rollback'
        USING ERRCODE = '40001';
    END IF;
  END IF;

  UPDATE public.whatsapp_session_handoff
  SET state = 'failed',
      error_code = COALESCE(error_code, 'rolled_back'),
      updated_at = clock_timestamp(),
      completed_at = clock_timestamp()
  WHERE session_id = p_session_id
    AND source_revision_id = p_previous_revision_id
    AND target_revision_id = p_candidate_revision_id
    AND state IN (
      'requested', 'draining', 'transforming', 'hydrating',
      'validating', 'promoting'
    );
  IF NOT FOUND THEN
    RAISE EXCEPTION 'whatsapp session rollback handoff changed'
      USING ERRCODE = '40001';
  END IF;
  RETURN true;
END;
$function$;

-- request_whatsapp_provider_handoff v16 used literal schema versions. This
-- narrow bridge is enabled only by the v17 wrapper installed below; direct
-- v16 runtime opens/candidate creation remain rejected.
CREATE OR REPLACE FUNCTION public.enforce_whatsapp_revision_schema_v17()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF NEW.schema_version = 16
    AND current_setting('app.whatsapp_schema_upgrade_bridge', true) = '17'
  THEN
    NEW.schema_version := 17;
    IF NEW.provider = 'wwebjs'
      AND NEW.source = 'handoff'
      AND NEW.format = 'whatsapp-canonical-v1'
    THEN
      -- The v16 lifecycle function did not know about the native WWeb
      -- profile manifest format. Preserve its authorization/locking logic,
      -- but expose the exact v17 target format expected by the library.
      NEW.format := 'wwebjs-profile-manifest-v1';
    END IF;
  END IF;
  IF NEW.schema_version <> 17 THEN
    RAISE EXCEPTION 'unsupported whatsapp shared schema version %', NEW.schema_version
      USING ERRCODE = '0A000';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_whatsapp_revision_schema_v17()
FROM PUBLIC;

CREATE TRIGGER whatsapp_session_revision_schema_v17_trigger
BEFORE INSERT OR UPDATE OF schema_version
ON public.whatsapp_session_revision
FOR EACH ROW EXECUTE FUNCTION public.enforce_whatsapp_revision_schema_v17();

ALTER TABLE public.whatsapp_session_revision
  ADD CONSTRAINT whatsapp_session_revision_version_check
  CHECK (schema_version = 17 AND codec_version > 0);

ALTER TABLE public.whatsapp_device
  ADD COLUMN adv_secret_available boolean,
  ADD COLUMN fingerprint_version text;

UPDATE public.whatsapp_device
SET adv_secret_available = adv_key IS NOT NULL;

-- A legacy WWeb profile could have a profile-derived fingerprint without the
-- canonical native credential core. It is not a portable companion identity:
-- invalidate it and require a native v17 checkpoint instead of blessing it as
-- v1 or inventing missing key material.
UPDATE public.whatsapp_device
SET device_fingerprint = NULL
WHERE device_fingerprint IS NOT NULL
  AND num_nulls(
    registration_id, noise_key, identity_key, signed_pre_key,
    signed_pre_key_id, signed_pre_key_sig, adv_details, adv_account_sig,
    adv_account_sig_key, adv_device_sig
  ) > 0;

UPDATE public.whatsapp_device
SET fingerprint_version =
  CASE
    WHEN device_fingerprint IS NULL THEN NULL
    ELSE 'underchat-whatsapp-device-fingerprint-v1'
  END;

ALTER TABLE public.whatsapp_device
  ALTER COLUMN adv_secret_available SET DEFAULT false,
  ALTER COLUMN adv_secret_available SET NOT NULL,
  DROP CONSTRAINT whatsapp_device_native_credentials_complete_check,
  DROP CONSTRAINT whatsapp_device_fingerprint_check;

ALTER TABLE public.whatsapp_device
  ADD CONSTRAINT whatsapp_device_native_credentials_complete_check
  CHECK (
    num_nonnulls(
      registration_id, noise_key, identity_key, signed_pre_key,
      signed_pre_key_id, signed_pre_key_sig, adv_details, adv_account_sig,
      adv_account_sig_key, adv_device_sig
    ) = 0
    OR
    num_nulls(
      registration_id, noise_key, identity_key, signed_pre_key,
      signed_pre_key_id, signed_pre_key_sig, adv_details, adv_account_sig,
      adv_account_sig_key, adv_device_sig
    ) = 0
  ),
  ADD CONSTRAINT whatsapp_device_adv_secret_check
  CHECK (
    (
      adv_secret_available
      AND adv_key IS NOT NULL
      AND octet_length(adv_key) = 32
      AND num_nulls(
        registration_id, noise_key, identity_key, signed_pre_key,
        signed_pre_key_id, signed_pre_key_sig, adv_details, adv_account_sig,
        adv_account_sig_key, adv_device_sig
      ) = 0
    )
    OR (NOT adv_secret_available AND adv_key IS NULL)
  ),
  ADD CONSTRAINT whatsapp_device_fingerprint_check
  CHECK (
    (device_fingerprint IS NULL AND fingerprint_version IS NULL)
    OR (
      device_fingerprint IS NOT NULL
      AND fingerprint_version IS NOT NULL
      AND octet_length(device_fingerprint) = 32
      AND fingerprint_version IN (
        'underchat-whatsapp-device-fingerprint-v1',
        'underchat-whatsapp-device-fingerprint-v2'
      )
      AND num_nulls(
        registration_id, noise_key, identity_key, signed_pre_key,
        signed_pre_key_id, signed_pre_key_sig, adv_details, adv_account_sig,
        adv_account_sig_key, adv_device_sig
      ) = 0
    )
  );

ALTER TABLE public.whatsapp_signal_sessions
  ADD COLUMN scope text NOT NULL DEFAULT 'default';

ALTER TABLE public.whatsapp_signal_sessions
  DROP CONSTRAINT whatsapp_signal_sessions_pk,
  ADD CONSTRAINT whatsapp_signal_sessions_pk
    PRIMARY KEY (session_id, revision_id, their_id, scope),
  ADD CONSTRAINT whatsapp_signal_sessions_scope_check
    CHECK (scope IN ('default', 'status', 'pq')),
  ADD CONSTRAINT whatsapp_signal_sessions_payload_check
    CHECK (
      session IS NULL
      OR octet_length(session) BETWEEN 1 AND 8388608
    );

ALTER TABLE public.whatsapp_sender_keys
  ADD CONSTRAINT whatsapp_sender_keys_payload_check
    CHECK (octet_length(sender_key) BETWEEN 1 AND 2097152);

-- Defensive transport/storage bounds. These are deliberately broad ceilings,
-- not claims that provider-specific protobuf fields have fixed lengths.
ALTER TABLE public.whatsapp_device
  ADD CONSTRAINT whatsapp_device_adv_details_size_check
    CHECK (
      adv_details IS NULL
      OR octet_length(adv_details) BETWEEN 1 AND 1048576
    );

ALTER TABLE public.whatsapp_app_state_sync_keys
  ADD CONSTRAINT whatsapp_app_state_sync_keys_payload_check
    CHECK (
      octet_length(key_id) BETWEEN 1 AND 1048576
      AND octet_length(key_data) BETWEEN 1 AND 1048576
      AND octet_length(fingerprint) BETWEEN 1 AND 1048576
    );

ALTER TABLE public.whatsapp_message_secrets
  ADD CONSTRAINT whatsapp_message_secrets_payload_check
    CHECK (octet_length(key) BETWEEN 1 AND 1048576);

ALTER TABLE public.whatsapp_privacy_tokens
  ADD CONSTRAINT whatsapp_privacy_tokens_payload_check
    CHECK (octet_length(token) BETWEEN 1 AND 1048576);

ALTER TABLE public.whatsapp_nct_salt
  ADD CONSTRAINT whatsapp_nct_salt_payload_check
    CHECK (octet_length(salt) BETWEEN 1 AND 1048576);

ALTER TABLE public.whatsapp_event_buffer
  ADD CONSTRAINT whatsapp_event_buffer_plaintext_check
    CHECK (plaintext IS NULL OR octet_length(plaintext) <= 8388608);

ALTER TABLE public.whatsapp_retry_buffer
  ADD CONSTRAINT whatsapp_retry_buffer_plaintext_check
    CHECK (octet_length(plaintext) <= 8388608);

ALTER TABLE public.whatsapp_provider_record
  ADD CONSTRAINT whatsapp_provider_record_payload_check
    CHECK (octet_length(payload) BETWEEN 1 AND 8388608);

ALTER TABLE public.whatsapp_artifact
  ADD CONSTRAINT whatsapp_artifact_manifest_size_check
    CHECK (octet_length(manifest::text) <= 1048576);

ALTER TABLE public.whatsapp_session
  ADD COLUMN active_device_fingerprint_version varchar(80);

UPDATE public.whatsapp_session AS session
SET active_device_fingerprint = device.device_fingerprint,
    active_device_fingerprint_version = device.fingerprint_version
FROM public.whatsapp_device AS device
WHERE device.session_id = session.session_id
  AND device.revision_id = session.active_revision_id;

ALTER TABLE public.whatsapp_session
  DROP CONSTRAINT whatsapp_session_fingerprint_check;

DROP INDEX public.whatsapp_session_active_device_fingerprint_uidx;

ALTER TABLE public.whatsapp_session
  ADD CONSTRAINT whatsapp_session_fingerprint_check
  CHECK (
    (
      active_device_fingerprint IS NULL
      AND active_device_fingerprint_version IS NULL
    )
    OR (
      active_device_fingerprint IS NOT NULL
      AND active_device_fingerprint_version IS NOT NULL
      AND octet_length(active_device_fingerprint) = 32
      AND active_device_fingerprint_version IN (
        'underchat-whatsapp-device-fingerprint-v1',
        'underchat-whatsapp-device-fingerprint-v2'
      )
    )
  );

CREATE UNIQUE INDEX whatsapp_session_active_device_fingerprint_uidx
ON public.whatsapp_session (
  active_device_fingerprint_version,
  active_device_fingerprint
)
WHERE active_device_fingerprint_version IS NOT NULL
  AND active_device_fingerprint IS NOT NULL;

-- Old SQL functions only assigned the fingerprint bytes. Derive and validate
-- the matching version from the active revision, and require v2 whenever a
-- pairing or provider promotion changes the ready identity.
CREATE OR REPLACE FUNCTION public.guard_whatsapp_session_fingerprint_v17()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_device_fingerprint bytea;
  v_fingerprint_version text;
  v_previous_fingerprint_version text;
  v_identity_changed boolean;
BEGIN
  IF NEW.active_revision_id IS NULL OR NEW.active_device_fingerprint IS NULL THEN
    IF NEW.active_device_fingerprint IS NULL THEN
      NEW.active_device_fingerprint_version := NULL;
    END IF;
    RETURN NEW;
  END IF;

  SELECT device.device_fingerprint, device.fingerprint_version
  INTO v_device_fingerprint, v_fingerprint_version
  FROM public.whatsapp_device AS device
  WHERE device.session_id = NEW.session_id
    AND device.revision_id = NEW.active_revision_id;

  IF NOT FOUND
    OR v_device_fingerprint IS DISTINCT FROM NEW.active_device_fingerprint
    OR v_fingerprint_version IS NULL
  THEN
    RAISE EXCEPTION 'active whatsapp companion fingerprint is not owned by its revision'
      USING ERRCODE = '23514';
  END IF;

  NEW.active_device_fingerprint_version := v_fingerprint_version;
  v_identity_changed := TG_OP = 'INSERT';
  IF TG_OP = 'UPDATE' THEN
    v_identity_changed :=
      NEW.active_revision_id IS DISTINCT FROM OLD.active_revision_id
      OR NEW.active_device_fingerprint IS DISTINCT FROM OLD.active_device_fingerprint
      OR NEW.state IS DISTINCT FROM OLD.state;

    IF OLD.active_revision_id IS NOT NULL
      AND NEW.active_revision_id IS DISTINCT FROM OLD.active_revision_id
      AND NEW.previous_revision_id IS NOT DISTINCT FROM OLD.active_revision_id
    THEN
      SELECT device.fingerprint_version
      INTO v_previous_fingerprint_version
      FROM public.whatsapp_device AS device
      WHERE device.session_id = NEW.session_id
        AND device.revision_id = OLD.active_revision_id;
      IF v_previous_fingerprint_version IS DISTINCT FROM v_fingerprint_version THEN
        RAISE EXCEPTION 'whatsapp handoff fingerprint versions differ'
          USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;

  IF NEW.state = 'ready'
    AND v_identity_changed
    AND v_fingerprint_version <> 'underchat-whatsapp-device-fingerprint-v2'
  THEN
    RAISE EXCEPTION 'new ready whatsapp identity requires fingerprint v2'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_whatsapp_session_fingerprint_v17()
FROM PUBLIC;

CREATE TRIGGER whatsapp_session_fingerprint_v17_trigger
BEFORE INSERT OR UPDATE OF
  state, active_revision_id, previous_revision_id,
  active_device_fingerprint, active_device_fingerprint_version
ON public.whatsapp_session
FOR EACH ROW EXECUTE FUNCTION public.guard_whatsapp_session_fingerprint_v17();

-- A native provider upgrades a legacy active v1 row during checkpoint. Keep
-- the header and clone-reservation key in the same transaction.
CREATE OR REPLACE FUNCTION public.sync_whatsapp_active_fingerprint_v17()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF NEW.device_fingerprint IS NULL OR NEW.fingerprint_version IS NULL THEN
    RETURN NEW;
  END IF;
  UPDATE public.whatsapp_session AS session
  SET active_device_fingerprint = NEW.device_fingerprint,
      active_device_fingerprint_version = NEW.fingerprint_version,
      updated_at = clock_timestamp()
  WHERE session.session_id = NEW.session_id
    AND session.active_revision_id = NEW.revision_id
    AND (
      session.active_device_fingerprint IS DISTINCT FROM NEW.device_fingerprint
      OR session.active_device_fingerprint_version IS DISTINCT FROM NEW.fingerprint_version
    );
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.sync_whatsapp_active_fingerprint_v17()
FROM PUBLIC;

CREATE TRIGGER whatsapp_device_active_fingerprint_v17_trigger
AFTER INSERT OR UPDATE OF device_fingerprint, fingerprint_version
ON public.whatsapp_device
FOR EACH ROW EXECUTE FUNCTION public.sync_whatsapp_active_fingerprint_v17();

-- Reserve a canonical companion before any provider opens its network
-- connection. The active-header unique index is still kept as defense in
-- depth, but promotion is too late to prevent two different session_ids from
-- validating the same cloned credentials concurrently. Source and target
-- revisions of one session share one reservation throughout handoff/rollback.
CREATE TABLE public.whatsapp_companion_reservation (
  fingerprint_version varchar(80) NOT NULL,
  device_fingerprint bytea NOT NULL,
  session_id uuid NOT NULL,
  reserved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT whatsapp_companion_reservation_pk PRIMARY KEY (
    fingerprint_version, device_fingerprint
  ),
  CONSTRAINT whatsapp_companion_reservation_session_uidx UNIQUE (session_id),
  CONSTRAINT whatsapp_companion_reservation_session_fk FOREIGN KEY (session_id)
    REFERENCES public.whatsapp_session(session_id) ON DELETE CASCADE,
  CONSTRAINT whatsapp_companion_reservation_fingerprint_check CHECK (
    fingerprint_version = 'underchat-whatsapp-device-fingerprint-v2'
    AND octet_length(device_fingerprint) = 32
  )
);

ALTER TABLE public.whatsapp_companion_reservation ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_companion_reservation FORCE ROW LEVEL SECURITY;

CREATE POLICY whatsapp_companion_reservation_scope
ON public.whatsapp_companion_reservation
USING (
  session_id = nullif(current_setting('app.whatsapp_session_id', true), '')::uuid
)
WITH CHECK (
  session_id = nullif(current_setting('app.whatsapp_session_id', true), '')::uuid
);

INSERT INTO public.whatsapp_companion_reservation (
  fingerprint_version, device_fingerprint, session_id
)
SELECT session.active_device_fingerprint_version,
       session.active_device_fingerprint,
       session.session_id
FROM public.whatsapp_session AS session
WHERE session.active_device_fingerprint_version =
        'underchat-whatsapp-device-fingerprint-v2'
  AND session.active_device_fingerprint IS NOT NULL;

CREATE OR REPLACE FUNCTION public.reserve_whatsapp_companion_v17()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_reserved_session_id uuid;
BEGIN
  IF NEW.fingerprint_version IS DISTINCT FROM
       'underchat-whatsapp-device-fingerprint-v2'
    OR NEW.device_fingerprint IS NULL
  THEN
    RETURN NEW;
  END IF;

  BEGIN
    INSERT INTO public.whatsapp_companion_reservation (
      fingerprint_version, device_fingerprint, session_id
    ) VALUES (
      NEW.fingerprint_version, NEW.device_fingerprint, NEW.session_id
    )
    RETURNING session_id INTO v_reserved_session_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT reservation.session_id
    INTO v_reserved_session_id
    FROM public.whatsapp_companion_reservation AS reservation
    WHERE reservation.fingerprint_version = NEW.fingerprint_version
      AND reservation.device_fingerprint = NEW.device_fingerprint;

    IF v_reserved_session_id IS NULL THEN
      RAISE EXCEPTION 'whatsapp session already reserves another companion identity'
        USING ERRCODE = '23505';
    END IF;
  END;

  IF v_reserved_session_id IS DISTINCT FROM NEW.session_id THEN
    RAISE EXCEPTION 'whatsapp companion identity is reserved by another session'
      USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.reserve_whatsapp_companion_v17()
FROM PUBLIC;

CREATE TRIGGER whatsapp_device_companion_reservation_v17_trigger
BEFORE INSERT OR UPDATE OF device_fingerprint, fingerprint_version
ON public.whatsapp_device
FOR EACH ROW EXECUTE FUNCTION public.reserve_whatsapp_companion_v17();

CREATE OR REPLACE FUNCTION public.release_empty_whatsapp_companion_v17()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF NEW.state = 'empty'
    AND NEW.active_revision_id IS NULL
    AND NEW.previous_revision_id IS NULL
  THEN
    DELETE FROM public.whatsapp_companion_reservation
    WHERE session_id = NEW.session_id;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.release_empty_whatsapp_companion_v17()
FROM PUBLIC;

CREATE TRIGGER whatsapp_session_companion_release_v17_trigger
AFTER UPDATE OF state, active_revision_id, previous_revision_id
ON public.whatsapp_session
FOR EACH ROW EXECUTE FUNCTION public.release_empty_whatsapp_companion_v17();

REVOKE ALL ON TABLE public.whatsapp_companion_reservation FROM PUBLIC;
REVOKE ALL ON TABLE public.whatsapp_companion_reservation
FROM whatsapp_session_runtime;

-- Fail closed for v16 runtime clients while retaining the audited v16
-- implementations as private implementation details of thin v17 wrappers.
ALTER FUNCTION public.open_whatsapp_session_revision(
  uuid, uuid, text, bigint, integer, uuid, text, text, integer, integer, text
) RENAME TO open_whatsapp_session_revision_schema16;

REVOKE ALL ON FUNCTION public.open_whatsapp_session_revision_schema16(
  uuid, uuid, text, bigint, integer, uuid, text, text, integer, integer, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.open_whatsapp_session_revision_schema16(
  uuid, uuid, text, bigint, integer, uuid, text, text, integer, integer, text
) FROM whatsapp_session_runtime;

CREATE OR REPLACE FUNCTION public.open_whatsapp_session_revision(
  p_session_id uuid,
  p_owner_id uuid,
  p_provider text,
  p_fencing_token bigint,
  p_generation integer,
  p_epoch uuid,
  p_capability text,
  p_source text DEFAULT 'pairing',
  p_schema_version integer DEFAULT 17,
  p_codec_version integer DEFAULT 1,
  p_format text DEFAULT 'whatsapp-canonical-v1'
)
RETURNS TABLE(revision_id bigint, status text, handoff_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF p_schema_version <> 17 THEN
    RAISE EXCEPTION 'unsupported whatsapp shared schema version %', p_schema_version
      USING ERRCODE = '0A000';
  END IF;
  RETURN QUERY
  SELECT opened.revision_id, opened.status, opened.handoff_id
  FROM public.open_whatsapp_session_revision_schema16(
    p_session_id, p_owner_id, p_provider, p_fencing_token, p_generation,
    p_epoch, p_capability, p_source, p_schema_version, p_codec_version,
    p_format
  ) AS opened;
END;
$function$;

REVOKE ALL ON FUNCTION public.open_whatsapp_session_revision(
  uuid, uuid, text, bigint, integer, uuid, text, text, integer, integer, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.open_whatsapp_session_revision(
  uuid, uuid, text, bigint, integer, uuid, text, text, integer, integer, text
) TO whatsapp_session_runtime;

ALTER FUNCTION public.create_whatsapp_session_candidate(
  uuid, bigint, uuid, text, bigint, integer, uuid, text, text,
  integer, integer, text
) RENAME TO create_whatsapp_session_candidate_schema16;

REVOKE ALL ON FUNCTION public.create_whatsapp_session_candidate_schema16(
  uuid, bigint, uuid, text, bigint, integer, uuid, text, text,
  integer, integer, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_whatsapp_session_candidate_schema16(
  uuid, bigint, uuid, text, bigint, integer, uuid, text, text,
  integer, integer, text
) FROM whatsapp_session_runtime;

CREATE OR REPLACE FUNCTION public.create_whatsapp_session_candidate(
  p_session_id uuid,
  p_expected_active_revision_id bigint,
  p_owner_id uuid,
  p_target_provider text,
  p_fencing_token bigint,
  p_generation integer,
  p_epoch uuid,
  p_capability text,
  p_source text,
  p_schema_version integer,
  p_codec_version integer,
  p_format text
)
RETURNS TABLE(revision_id bigint, handoff_id uuid, source_revision_id bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF p_schema_version <> 17 THEN
    RAISE EXCEPTION 'unsupported whatsapp shared schema version %', p_schema_version
      USING ERRCODE = '0A000';
  END IF;
  RETURN QUERY
  SELECT candidate.revision_id, candidate.handoff_id,
         candidate.source_revision_id
  FROM public.create_whatsapp_session_candidate_schema16(
    p_session_id, p_expected_active_revision_id, p_owner_id,
    p_target_provider, p_fencing_token, p_generation, p_epoch, p_capability,
    p_source, p_schema_version, p_codec_version, p_format
  ) AS candidate;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_whatsapp_session_candidate(
  uuid, bigint, uuid, text, bigint, integer, uuid, text, text,
  integer, integer, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_whatsapp_session_candidate(
  uuid, bigint, uuid, text, bigint, integer, uuid, text, text,
  integer, integer, text
) TO whatsapp_session_runtime;

ALTER FUNCTION public.request_whatsapp_provider_handoff(
  uuid, uuid, text, text, uuid
) RENAME TO request_whatsapp_provider_handoff_schema16;

REVOKE ALL ON FUNCTION public.request_whatsapp_provider_handoff_schema16(
  uuid, uuid, text, text, uuid
) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.request_whatsapp_provider_handoff(
  p_session_id uuid,
  p_account_id uuid,
  p_source_provider text,
  p_target_provider text,
  p_lifecycle_operation_id uuid
)
RETURNS TABLE(
  handoff_id uuid,
  target_revision_id bigint,
  source_revision_id bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  PERFORM set_config('app.whatsapp_schema_upgrade_bridge', '17', true);
  RETURN QUERY
  SELECT requested.handoff_id, requested.target_revision_id,
         requested.source_revision_id
  FROM public.request_whatsapp_provider_handoff_schema16(
    p_session_id, p_account_id, p_source_provider, p_target_provider,
    p_lifecycle_operation_id
  ) AS requested;
END;
$function$;

REVOKE ALL ON FUNCTION public.request_whatsapp_provider_handoff(
  uuid, uuid, text, text, uuid
) FROM PUBLIC;

-- Keep the original, fully audited multi-provider CAS as a private primitive.
-- Public WWebJS promotion must use the two-phase activation functions below;
-- otherwise a caller could mark a browser-backed handoff ready before its
-- first authenticated, stable checkpoint.
ALTER FUNCTION public.promote_whatsapp_session_revision(
  uuid, bigint, bigint, uuid, bigint, integer, uuid, text, text
) RENAME TO promote_whatsapp_session_revision_v17_impl;

REVOKE ALL ON FUNCTION public.promote_whatsapp_session_revision_v17_impl(
  uuid, bigint, bigint, uuid, bigint, integer, uuid, text, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.promote_whatsapp_session_revision_v17_impl(
  uuid, bigint, bigint, uuid, bigint, integer, uuid, text, text
) FROM whatsapp_session_runtime;

CREATE OR REPLACE FUNCTION public.promote_whatsapp_session_revision(
  p_session_id uuid,
  p_expected_active_revision_id bigint,
  p_target_revision_id bigint,
  p_owner_id uuid,
  p_fencing_token bigint,
  p_generation integer,
  p_epoch uuid,
  p_capability text,
  p_expected_jid text DEFAULT NULL::text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_promoted boolean;
BEGIN
  v_promoted := public.promote_whatsapp_session_revision_v17_impl(
    p_session_id, p_expected_active_revision_id, p_target_revision_id,
    p_owner_id, p_fencing_token, p_generation, p_epoch, p_capability,
    p_expected_jid
  );

  -- Raising after the private CAS rolls the entire statement back, including
  -- revision/worker/outbox triggers. Pairing has no handoff row and uses its
  -- dedicated finalizer, so only lifecycle candidates are rejected here.
  IF EXISTS (
    SELECT 1
    FROM public.whatsapp_session_handoff AS handoff
    WHERE handoff.session_id = p_session_id
      AND handoff.source_revision_id = p_expected_active_revision_id
      AND handoff.target_revision_id = p_target_revision_id
      AND handoff.target_provider = 'wwebjs'
      AND handoff.state = 'completed'
  ) THEN
    RAISE EXCEPTION
      'WWebJS handoff requires offline activation commit and connected finalization'
      USING ERRCODE = '0A000';
  END IF;
  RETURN v_promoted;
END;
$function$;

REVOKE ALL ON FUNCTION public.promote_whatsapp_session_revision(
  uuid, bigint, bigint, uuid, bigint, integer, uuid, text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.promote_whatsapp_session_revision(
  uuid, bigint, bigint, uuid, bigint, integer, uuid, text, text
) TO whatsapp_session_runtime;

CREATE OR REPLACE FUNCTION public.commit_whatsapp_session_activation(
  p_session_id uuid,
  p_expected_active_revision_id bigint,
  p_target_revision_id bigint,
  p_owner_id uuid,
  p_fencing_token bigint,
  p_generation integer,
  p_epoch uuid,
  p_capability text,
  p_expected_jid text DEFAULT NULL::text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_activation_marker jsonb;
  v_pre_activation_artifact_id uuid;
  v_boundary timestamptz;
BEGIN
  IF p_expected_active_revision_id IS NULL
    OR p_target_revision_id IS NULL
    OR p_expected_active_revision_id = p_target_revision_id
  THEN
    RAISE EXCEPTION 'invalid WWebJS activation revisions'
      USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('app.whatsapp_session_id', p_session_id::text, true);
  -- Preserve the global lifecycle lock order used by promotion/rollback.
  PERFORM 1
  FROM public.worker AS worker
  WHERE worker.worker_id = p_session_id
    AND worker.session_storage = 'postgres'
    AND worker.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'whatsapp worker is unavailable for WWebJS activation'
      USING ERRCODE = '55000';
  END IF;

  PERFORM public.begin_whatsapp_session_mutation(
    p_session_id, p_target_revision_id, p_owner_id, p_fencing_token,
    p_generation, p_epoch, p_capability
  );

  -- Idempotent retry after finalization (for example, a lost SQL response).
  IF EXISTS (
    SELECT 1
    FROM public.whatsapp_session AS session
    JOIN public.whatsapp_session_handoff AS handoff
      ON handoff.session_id = session.session_id
     AND handoff.source_revision_id = p_expected_active_revision_id
     AND handoff.target_revision_id = p_target_revision_id
    WHERE session.session_id = p_session_id
      AND session.provider = 'wwebjs'
      AND session.active_revision_id = p_target_revision_id
      AND session.previous_revision_id = p_expected_active_revision_id
      AND session.state = 'ready'
      AND handoff.target_provider = 'wwebjs'
      AND handoff.state = 'completed'
      AND handoff.point_of_no_return_at IS NOT NULL
      AND handoff.pre_activation_artifact_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.whatsapp_provider_record AS marker
        WHERE marker.session_id = p_session_id
          AND marker.revision_id = p_target_revision_id
          AND marker.namespace = '_wwebjs_lifecycle'
          AND marker.record_key = 'pending_canonical_activation_v1'
      )
  ) THEN
    RETURN true;
  END IF;

  -- Idempotent retry while activation is deliberately incomplete.
  IF EXISTS (
    SELECT 1
    FROM public.whatsapp_session AS session
    JOIN public.whatsapp_session_handoff AS handoff
      ON handoff.session_id = session.session_id
     AND handoff.source_revision_id = p_expected_active_revision_id
     AND handoff.target_revision_id = p_target_revision_id
    WHERE session.session_id = p_session_id
      AND session.provider = 'wwebjs'
      AND session.active_revision_id = p_target_revision_id
      AND session.previous_revision_id = p_expected_active_revision_id
      AND session.state = 'preparing'
      AND handoff.target_provider = 'wwebjs'
      AND handoff.state = 'activating'
      AND handoff.point_of_no_return_at IS NOT NULL
      AND handoff.pre_activation_artifact_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.whatsapp_provider_record AS marker
        WHERE marker.session_id = p_session_id
          AND marker.revision_id = p_target_revision_id
          AND marker.namespace = '_wwebjs_lifecycle'
          AND marker.record_key = 'pending_canonical_activation_v1'
          AND marker.codec_version = 1
      )
  ) THEN
    RETURN true;
  END IF;

  PERFORM 1
  FROM public.whatsapp_session AS session
  JOIN public.whatsapp_session_handoff AS handoff
    ON handoff.session_id = session.session_id
   AND handoff.source_revision_id = p_expected_active_revision_id
   AND handoff.target_revision_id = p_target_revision_id
  JOIN public.whatsapp_session_revision AS target_revision
    ON target_revision.session_id = handoff.session_id
   AND target_revision.revision_id = handoff.target_revision_id
  WHERE session.session_id = p_session_id
    AND session.active_revision_id = p_expected_active_revision_id
    AND session.provider = handoff.source_provider
    AND session.state = 'handoff'
    AND handoff.target_provider = 'wwebjs'
    AND handoff.state IN ('transforming', 'hydrating', 'validating', 'promoting')
    AND target_revision.provider = 'wwebjs'
    AND target_revision.status IN ('staging', 'validating')
  FOR UPDATE OF handoff;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WWebJS activation lineage changed before commit'
      USING ERRCODE = '40001';
  END IF;

  SELECT convert_from(marker.payload, 'UTF8')::jsonb
  INTO v_activation_marker
  FROM public.whatsapp_provider_record AS marker
  WHERE marker.session_id = p_session_id
    AND marker.revision_id = p_target_revision_id
    AND marker.namespace = '_wwebjs_lifecycle'
    AND marker.record_key = 'pending_canonical_activation_v1'
    AND marker.codec_version = 1
  FOR UPDATE;
  IF NOT FOUND
    OR jsonb_typeof(v_activation_marker) IS DISTINCT FROM 'object'
    OR (v_activation_marker ->> 'version') IS DISTINCT FROM '1'
    OR jsonb_typeof(
      v_activation_marker -> 'app_state_hydration_required'
    ) IS DISTINCT FROM 'boolean'
    OR jsonb_typeof(
      v_activation_marker -> 'pq_bootstrap_required'
    ) IS DISTINCT FROM 'boolean'
    OR jsonb_typeof(
      v_activation_marker -> 'ready_checkpoint_artifact_id'
    ) IS DISTINCT FROM 'null'
    OR jsonb_typeof(
      v_activation_marker -> 'ready_checkpoint_checksum_sha256'
    ) IS DISTINCT FROM 'null'
  THEN
    RAISE EXCEPTION 'WWebJS canonical activation marker is missing or invalid'
      USING ERRCODE = '23514';
  END IF;

  SELECT artifact.artifact_id
  INTO v_pre_activation_artifact_id
  FROM public.whatsapp_artifact AS artifact
  JOIN public.whatsapp_session_revision AS revision
    ON revision.session_id = artifact.session_id
   AND revision.revision_id = artifact.revision_id
   AND revision.checksum_sha256 = artifact.checksum_sha256
  WHERE artifact.session_id = p_session_id
    AND artifact.revision_id = p_target_revision_id
    AND artifact.provider = 'wwebjs'
    AND artifact.kind = 'wwebjs_profile'
    AND artifact.status = 'ready'
  ORDER BY artifact.persisted_at DESC, artifact.artifact_id
  LIMIT 1
  FOR SHARE OF artifact;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WWebJS offline activation artifact is unavailable'
      USING ERRCODE = '23514';
  END IF;

  -- The private primitive performs identity/fingerprint verification and the
  -- atomic provider/revision/worker CAS. It temporarily reaches ready/completed
  -- inside this transaction; the following writes replace those states before
  -- anything becomes externally visible.
  PERFORM public.promote_whatsapp_session_revision_v17_impl(
    p_session_id, p_expected_active_revision_id, p_target_revision_id,
    p_owner_id, p_fencing_token, p_generation, p_epoch, p_capability,
    p_expected_jid
  );

  v_boundary := clock_timestamp();
  UPDATE public.whatsapp_session
  SET state = 'preparing',
      last_error_at = NULL,
      updated_at = v_boundary
  WHERE session_id = p_session_id
    AND provider = 'wwebjs'
    AND active_revision_id = p_target_revision_id
    AND previous_revision_id = p_expected_active_revision_id
    AND state = 'ready'
    AND generation = p_generation
    AND epoch = p_epoch;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WWebJS session header changed at activation commit'
      USING ERRCODE = '40001';
  END IF;

  UPDATE public.whatsapp_session_handoff
  SET state = 'activating',
      point_of_no_return_at = v_boundary,
      pre_activation_artifact_id = v_pre_activation_artifact_id,
      updated_at = v_boundary,
      completed_at = NULL
  WHERE session_id = p_session_id
    AND source_revision_id = p_expected_active_revision_id
    AND target_revision_id = p_target_revision_id
    AND target_provider = 'wwebjs'
    AND state = 'completed';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WWebJS activation lineage changed at commit'
      USING ERRCODE = '40001';
  END IF;
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.finalize_whatsapp_session_activation(
  p_session_id uuid,
  p_target_revision_id bigint,
  p_owner_id uuid,
  p_fencing_token bigint,
  p_generation integer,
  p_epoch uuid,
  p_capability text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_activation_marker jsonb;
  v_point_of_no_return_at timestamptz;
  v_pre_activation_artifact_id uuid;
  v_target_checksum text;
  v_ready_checkpoint_artifact_id uuid;
  v_ready_checkpoint_checksum text;
BEGIN
  IF p_target_revision_id IS NULL THEN
    RAISE EXCEPTION 'invalid WWebJS activation finalization revision'
      USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('app.whatsapp_session_id', p_session_id::text, true);
  PERFORM 1
  FROM public.worker AS worker
  WHERE worker.worker_id = p_session_id
    AND worker.worker_type_id =
      '019a930d-c6f6-766d-9c84-62b9c3e7d1f0'::uuid
    AND worker.session_storage = 'postgres'
    AND worker.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WWebJS worker is unavailable for activation finalization'
      USING ERRCODE = '55000';
  END IF;

  PERFORM public.begin_whatsapp_session_mutation(
    p_session_id, p_target_revision_id, p_owner_id, p_fencing_token,
    p_generation, p_epoch, p_capability
  );

  IF EXISTS (
    SELECT 1
    FROM public.whatsapp_session AS session
    JOIN public.whatsapp_session_handoff AS handoff
      ON handoff.session_id = session.session_id
     AND handoff.target_revision_id = p_target_revision_id
    WHERE session.session_id = p_session_id
      AND session.provider = 'wwebjs'
      AND session.active_revision_id = p_target_revision_id
      AND session.state = 'ready'
      AND handoff.target_provider = 'wwebjs'
      AND handoff.state = 'completed'
      AND handoff.point_of_no_return_at IS NOT NULL
      AND handoff.pre_activation_artifact_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.whatsapp_provider_record AS marker
        WHERE marker.session_id = p_session_id
          AND marker.revision_id = p_target_revision_id
          AND marker.namespace = '_wwebjs_lifecycle'
          AND marker.record_key = 'pending_canonical_activation_v1'
      )
  ) THEN
    RETURN true;
  END IF;

  SELECT handoff.point_of_no_return_at,
         handoff.pre_activation_artifact_id,
         target_revision.checksum_sha256
  INTO v_point_of_no_return_at, v_pre_activation_artifact_id,
       v_target_checksum
  FROM public.whatsapp_session AS session
  JOIN public.whatsapp_session_handoff AS handoff
    ON handoff.session_id = session.session_id
   AND handoff.target_revision_id = p_target_revision_id
  JOIN public.whatsapp_session_revision AS source_revision
    ON source_revision.session_id = handoff.session_id
   AND source_revision.revision_id = handoff.source_revision_id
  JOIN public.whatsapp_session_revision AS target_revision
    ON target_revision.session_id = handoff.session_id
   AND target_revision.revision_id = handoff.target_revision_id
  WHERE session.session_id = p_session_id
    AND session.provider = 'wwebjs'
    AND session.active_revision_id = p_target_revision_id
    AND session.previous_revision_id = handoff.source_revision_id
    AND session.state = 'preparing'
    AND session.active_device_fingerprint IS NOT NULL
    AND handoff.target_provider = 'wwebjs'
    AND handoff.state = 'activating'
    AND handoff.point_of_no_return_at IS NOT NULL
    AND handoff.pre_activation_artifact_id IS NOT NULL
    AND source_revision.status = 'retired'
    AND target_revision.provider = 'wwebjs'
    AND target_revision.status = 'active'
    AND target_revision.checksum_sha256 IS NOT NULL
    AND target_revision.persisted_at >= handoff.point_of_no_return_at
    AND session.last_persisted_at >= handoff.point_of_no_return_at
  FOR UPDATE OF handoff;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WWebJS activation is not ready for finalization'
      USING ERRCODE = '55000';
  END IF;

  SELECT convert_from(marker.payload, 'UTF8')::jsonb
  INTO v_activation_marker
  FROM public.whatsapp_provider_record AS marker
  WHERE marker.session_id = p_session_id
    AND marker.revision_id = p_target_revision_id
    AND marker.namespace = '_wwebjs_lifecycle'
    AND marker.record_key = 'pending_canonical_activation_v1'
    AND marker.codec_version = 1
  FOR UPDATE;
  IF NOT FOUND
    OR jsonb_typeof(v_activation_marker) IS DISTINCT FROM 'object'
    OR (v_activation_marker ->> 'version') IS DISTINCT FROM '1'
    OR (v_activation_marker ->> 'app_state_hydration_required')
      IS DISTINCT FROM 'false'
    OR (v_activation_marker ->> 'pq_bootstrap_required')
      IS DISTINCT FROM 'false'
    OR jsonb_typeof(
      v_activation_marker -> 'ready_checkpoint_artifact_id'
    ) IS DISTINCT FROM 'string'
    OR (v_activation_marker ->> 'ready_checkpoint_artifact_id')
      !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    OR jsonb_typeof(
      v_activation_marker -> 'ready_checkpoint_checksum_sha256'
    ) IS DISTINCT FROM 'string'
    OR (v_activation_marker ->> 'ready_checkpoint_checksum_sha256')
      !~ '^[0-9a-f]{64}$'
  THEN
    RAISE EXCEPTION 'WWebJS canonical activation work is incomplete'
      USING ERRCODE = '23514';
  END IF;

  v_ready_checkpoint_artifact_id :=
    (v_activation_marker ->> 'ready_checkpoint_artifact_id')::uuid;
  v_ready_checkpoint_checksum :=
    v_activation_marker ->> 'ready_checkpoint_checksum_sha256';

  PERFORM 1
  FROM public.whatsapp_artifact AS artifact
  WHERE artifact.session_id = p_session_id
    AND artifact.revision_id = p_target_revision_id
    AND artifact.provider = 'wwebjs'
    AND artifact.kind = 'wwebjs_profile'
    AND artifact.status = 'ready'
    AND artifact.artifact_id = v_ready_checkpoint_artifact_id
    AND artifact.artifact_id <> v_pre_activation_artifact_id
    AND artifact.checksum_sha256 = v_ready_checkpoint_checksum
    AND artifact.checksum_sha256 = v_target_checksum
    AND artifact.persisted_at >= v_point_of_no_return_at
  FOR SHARE OF artifact;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WWebJS post-activation stable checkpoint is missing'
      USING ERRCODE = '23514';
  END IF;

  DELETE FROM public.whatsapp_provider_record AS marker
  WHERE marker.session_id = p_session_id
    AND marker.revision_id = p_target_revision_id
    AND marker.namespace = '_wwebjs_lifecycle'
    AND marker.record_key = 'pending_canonical_activation_v1'
    AND marker.codec_version = 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WWebJS canonical activation marker changed'
      USING ERRCODE = '40001';
  END IF;

  UPDATE public.whatsapp_session
  SET state = 'ready',
      last_error_at = NULL,
      updated_at = clock_timestamp()
  WHERE session_id = p_session_id
    AND provider = 'wwebjs'
    AND active_revision_id = p_target_revision_id
    AND state = 'preparing'
    AND generation = p_generation
    AND epoch = p_epoch;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WWebJS session changed during activation finalization'
      USING ERRCODE = '40001';
  END IF;

  UPDATE public.whatsapp_session_handoff
  SET state = 'completed',
      updated_at = clock_timestamp(),
      completed_at = clock_timestamp()
  WHERE session_id = p_session_id
    AND target_revision_id = p_target_revision_id
    AND target_provider = 'wwebjs'
    AND state = 'activating'
    AND point_of_no_return_at = v_point_of_no_return_at
    AND pre_activation_artifact_id = v_pre_activation_artifact_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WWebJS activation lineage changed before completion'
      USING ERRCODE = '40001';
  END IF;
  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.commit_whatsapp_session_activation(
  uuid, bigint, bigint, uuid, bigint, integer, uuid, text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.commit_whatsapp_session_activation(
  uuid, bigint, bigint, uuid, bigint, integer, uuid, text, text
) TO whatsapp_session_runtime;
REVOKE ALL ON FUNCTION public.finalize_whatsapp_session_activation(
  uuid, bigint, uuid, bigint, integer, uuid, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_whatsapp_session_activation(
  uuid, bigint, uuid, bigint, integer, uuid, text
) TO whatsapp_session_runtime;
