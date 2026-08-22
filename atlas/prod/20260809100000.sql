-- WWebJS immutable profile anchor + fresh canonical authority.
--
-- This migration is deliberately additive to canonical schema v17.  It does
-- not backfill authority rows: legacy runtimes remain valid until a new
-- runtime atomically adopts a verified profile artifact.  From that point the
-- operation ABI fence prevents a legacy writer from rotating that artifact.

-- Bind an authority row to the exact artifact revision, while retaining
-- ON DELETE CASCADE during the rolling 1.34.39 window.  The legacy writer's
-- artifact DELETE therefore removes an authority row rather than failing the
-- complete checkpoint transaction.
ALTER TABLE public.whatsapp_artifact
  ADD CONSTRAINT whatsapp_artifact_revision_artifact_uq
  UNIQUE (session_id, revision_id, artifact_id);

DO $wwebjs_ready_profile_preflight$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.whatsapp_artifact AS artifact
    WHERE artifact.provider = 'wwebjs'
      AND artifact.kind = 'wwebjs_profile'
      AND artifact.status = 'ready'
    GROUP BY artifact.session_id, artifact.revision_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'multiple ready WWebJS profile artifacts prevent anchor authority installation'
      USING ERRCODE = '55000';
  END IF;
END;
$wwebjs_ready_profile_preflight$;

CREATE UNIQUE INDEX whatsapp_artifact_wwebjs_ready_profile_uidx
ON public.whatsapp_artifact (session_id, revision_id)
WHERE provider = 'wwebjs'
  AND kind = 'wwebjs_profile'
  AND status = 'ready';

CREATE INDEX whatsapp_artifact_wwebjs_retired_profile_gc_idx
ON public.whatsapp_artifact (
  persisted_at, session_id, revision_id, artifact_id
)
WHERE provider = 'wwebjs'
  AND kind = 'wwebjs_profile'
  AND status = 'retired';

CREATE INDEX whatsapp_session_handoff_pre_activation_artifact_idx
ON public.whatsapp_session_handoff (session_id, pre_activation_artifact_id)
WHERE pre_activation_artifact_id IS NOT NULL;

CREATE TABLE public.whatsapp_wwebjs_profile_anchor (
  session_id uuid NOT NULL,
  revision_id bigint NOT NULL,
  anchor_generation bigint NOT NULL,
  artifact_id uuid NOT NULL,
  state varchar(16) NOT NULL,
  checkpoint_mode varchar(64) NOT NULL,
  artifact_checksum_sha256 varchar(64) NOT NULL,
  artifact_size_bytes bigint NOT NULL,
  artifact_chunk_count integer NOT NULL,
  artifact_persisted_at timestamptz NOT NULL,
  artifact_verified_at timestamptz NOT NULL,
  baseline_app_state_checksum_sha256 varchar(64),
  current_app_state_checksum_sha256 varchar(64) NOT NULL,
  app_state_overlay_required boolean NOT NULL,
  canonical_generation bigint NOT NULL,
  canonical_checksum_sha256 varchar(64) NOT NULL,
  canonical_record_count integer NOT NULL,
  canonical_size_bytes bigint NOT NULL,
  canonical_persisted_at timestamptz NOT NULL,
  source varchar(64) NOT NULL,
  last_profile_observed_size_bytes bigint,
  retain_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_wwebjs_profile_anchor_pk
    PRIMARY KEY (session_id, revision_id, anchor_generation),
  CONSTRAINT whatsapp_wwebjs_profile_anchor_artifact_uq
    UNIQUE (session_id, revision_id, artifact_id),
  CONSTRAINT whatsapp_wwebjs_profile_anchor_revision_fk
    FOREIGN KEY (session_id, revision_id)
    REFERENCES public.whatsapp_session_revision (session_id, revision_id)
    ON DELETE CASCADE,
  CONSTRAINT whatsapp_wwebjs_profile_anchor_artifact_fk
    FOREIGN KEY (session_id, revision_id, artifact_id)
    REFERENCES public.whatsapp_artifact (
      session_id, revision_id, artifact_id
    )
    ON DELETE CASCADE,
  CONSTRAINT whatsapp_wwebjs_profile_anchor_generation_check
    CHECK (anchor_generation > 0 AND canonical_generation > 0),
  CONSTRAINT whatsapp_wwebjs_profile_anchor_state_check
    CHECK (state IN ('active', 'previous')),
  CONSTRAINT whatsapp_wwebjs_profile_anchor_mode_check
    CHECK (checkpoint_mode IN (
      'legacy_adoption_v1',
      'full_profile_plus_fresh_canonical_v1',
      'immutable_profile_anchor_plus_fresh_canonical_v1',
      'last_good_plus_fresh_canonical_v1'
    )),
  CONSTRAINT whatsapp_wwebjs_profile_anchor_artifact_checksum_check
    CHECK (artifact_checksum_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT whatsapp_wwebjs_profile_anchor_artifact_size_check
    CHECK (artifact_size_bytes BETWEEN 1 AND 536870912),
  CONSTRAINT whatsapp_wwebjs_profile_anchor_artifact_chunk_count_check
    CHECK (artifact_chunk_count BETWEEN 1 AND 65536),
  CONSTRAINT whatsapp_wwebjs_profile_anchor_baseline_checksum_check
    CHECK (
      baseline_app_state_checksum_sha256 IS NULL
      OR baseline_app_state_checksum_sha256 ~ '^[0-9a-f]{64}$'
    ),
  CONSTRAINT whatsapp_wwebjs_profile_anchor_current_checksum_check
    CHECK (current_app_state_checksum_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT whatsapp_wwebjs_profile_anchor_overlay_check
    CHECK (
      app_state_overlay_required
      OR baseline_app_state_checksum_sha256 =
         current_app_state_checksum_sha256
    ),
  CONSTRAINT whatsapp_wwebjs_profile_anchor_canonical_checksum_check
    CHECK (canonical_checksum_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT whatsapp_wwebjs_profile_anchor_canonical_shape_check
    CHECK (
      canonical_record_count >= 0
      AND canonical_size_bytes BETWEEN 1 AND 67108864
    ),
  CONSTRAINT whatsapp_wwebjs_profile_anchor_source_check
    CHECK (source ~ '^[a-z][a-z0-9_]{0,63}$'),
  CONSTRAINT whatsapp_wwebjs_profile_anchor_observed_size_check
    CHECK (
      last_profile_observed_size_bytes IS NULL
      OR last_profile_observed_size_bytes >= 0
    ),
  CONSTRAINT whatsapp_wwebjs_profile_anchor_retention_check
    CHECK (
      (state = 'active' AND retain_until IS NULL)
      OR (state = 'previous' AND retain_until IS NOT NULL)
    )
) WITH (fillfactor = 90);

CREATE UNIQUE INDEX whatsapp_wwebjs_profile_anchor_active_uidx
ON public.whatsapp_wwebjs_profile_anchor (session_id, revision_id)
WHERE state = 'active';

CREATE UNIQUE INDEX whatsapp_wwebjs_profile_anchor_previous_uidx
ON public.whatsapp_wwebjs_profile_anchor (session_id, revision_id)
WHERE state = 'previous';

CREATE INDEX whatsapp_wwebjs_profile_anchor_gc_idx
ON public.whatsapp_wwebjs_profile_anchor (
  retain_until, session_id, revision_id, anchor_generation
)
WHERE state = 'previous';

CREATE INDEX whatsapp_wwebjs_profile_anchor_artifact_idx
ON public.whatsapp_wwebjs_profile_anchor (session_id, artifact_id);

ALTER TABLE public.whatsapp_wwebjs_profile_anchor ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_wwebjs_profile_anchor FORCE ROW LEVEL SECURITY;

CREATE POLICY whatsapp_wwebjs_profile_anchor_owner
ON public.whatsapp_wwebjs_profile_anchor
FOR ALL
USING (
  current_user = pg_catalog.pg_get_userbyid((
    SELECT relation.relowner
    FROM pg_catalog.pg_class AS relation
    WHERE relation.oid = 'public.whatsapp_session'::regclass
  ))
)
WITH CHECK (
  current_user = pg_catalog.pg_get_userbyid((
    SELECT relation.relowner
    FROM pg_catalog.pg_class AS relation
    WHERE relation.oid = 'public.whatsapp_session'::regclass
  ))
);

CREATE POLICY whatsapp_wwebjs_profile_anchor_runtime_select
ON public.whatsapp_wwebjs_profile_anchor
FOR SELECT
TO whatsapp_session_runtime
USING (
  session_id = (SELECT nullif(
    current_setting('app.whatsapp_session_id', true), ''
  )::uuid)
  AND revision_id = (SELECT nullif(
    current_setting('app.whatsapp_revision_id', true), ''
  )::bigint)
  AND (SELECT public.whatsapp_runtime_scope_is_valid())
);

-- Preserve the deployed seven-argument implementations as private cores.
-- The public ABI wrappers below make adoption the rolling-version boundary.
DO $wwebjs_profile_anchor_operation_core$
BEGIN
  IF to_regprocedure(
    'public.begin_whatsapp_session_operation_v17_core(uuid,bigint,uuid,bigint,integer,uuid,text)'
  ) IS NULL THEN
    ALTER FUNCTION public.begin_whatsapp_session_operation(
      uuid, bigint, uuid, bigint, integer, uuid, text
    ) RENAME TO begin_whatsapp_session_operation_v17_core;
  END IF;
END;
$wwebjs_profile_anchor_operation_core$;

CREATE OR REPLACE FUNCTION public.begin_whatsapp_session_operation(
  p_session_id uuid,
  p_revision_id bigint,
  p_owner_id uuid,
  p_fencing_token bigint,
  p_generation integer,
  p_epoch uuid,
  p_capability text,
  p_operation_abi text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_allowed boolean;
BEGIN
  IF p_operation_abi IS DISTINCT FROM
    'profile-anchor-canonical-checkpoint-v1'
  THEN
    RAISE EXCEPTION 'unsupported WWebJS profile anchor operation ABI'
      USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('app.whatsapp_operation_abi', p_operation_abi, true);
  v_allowed := public.begin_whatsapp_session_operation_v17_core(
    p_session_id, p_revision_id, p_owner_id, p_fencing_token,
    p_generation, p_epoch, p_capability
  );
  RETURN v_allowed;
END;
$function$;

CREATE OR REPLACE FUNCTION public.begin_whatsapp_session_operation(
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
  v_allowed boolean;
BEGIN
  v_allowed := public.begin_whatsapp_session_operation_v17_core(
    p_session_id, p_revision_id, p_owner_id, p_fencing_token,
    p_generation, p_epoch, p_capability
  );

  IF EXISTS (
      SELECT 1
      FROM public.whatsapp_wwebjs_profile_anchor AS anchor
      WHERE anchor.session_id = p_session_id
        AND anchor.revision_id = p_revision_id
        AND anchor.state = 'active'
    )
  THEN
    RAISE EXCEPTION 'WWebJS profile anchor requires the current operation ABI'
      USING ERRCODE = '55000';
  END IF;

  RETURN v_allowed;
END;
$function$;

DO $wwebjs_profile_anchor_mutation_core$
BEGIN
  IF to_regprocedure(
    'public.begin_whatsapp_session_mutation_v17_core(uuid,bigint,uuid,bigint,integer,uuid,text)'
  ) IS NULL THEN
    ALTER FUNCTION public.begin_whatsapp_session_mutation(
      uuid, bigint, uuid, bigint, integer, uuid, text
    ) RENAME TO begin_whatsapp_session_mutation_v17_core;
  END IF;
END;
$wwebjs_profile_anchor_mutation_core$;

CREATE OR REPLACE FUNCTION public.begin_whatsapp_session_mutation(
  p_session_id uuid,
  p_revision_id bigint,
  p_owner_id uuid,
  p_fencing_token bigint,
  p_generation integer,
  p_epoch uuid,
  p_capability text,
  p_operation_abi text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_allowed boolean;
BEGIN
  IF p_operation_abi IS DISTINCT FROM
    'profile-anchor-canonical-checkpoint-v1'
  THEN
    RAISE EXCEPTION 'unsupported WWebJS profile anchor mutation ABI'
      USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('app.whatsapp_operation_abi', p_operation_abi, true);
  v_allowed := public.begin_whatsapp_session_mutation_v17_core(
    p_session_id, p_revision_id, p_owner_id, p_fencing_token,
    p_generation, p_epoch, p_capability
  );
  RETURN v_allowed;
END;
$function$;

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
  v_allowed boolean;
BEGIN
  v_allowed := public.begin_whatsapp_session_mutation_v17_core(
    p_session_id, p_revision_id, p_owner_id, p_fencing_token,
    p_generation, p_epoch, p_capability
  );

  IF EXISTS (
      SELECT 1
      FROM public.whatsapp_wwebjs_profile_anchor AS anchor
      WHERE anchor.session_id = p_session_id
        AND anchor.revision_id = p_revision_id
        AND anchor.state = 'active'
    )
  THEN
    RAISE EXCEPTION 'WWebJS profile anchor requires the current mutation ABI'
      USING ERRCODE = '55000';
  END IF;

  RETURN v_allowed;
END;
$function$;

CREATE OR REPLACE FUNCTION public.commit_wwebjs_profile_anchor_checkpoint_v1(
  p_session_id uuid,
  p_revision_id bigint,
  p_artifact_id uuid,
  p_expected_artifact_id uuid,
  p_expected_anchor_generation bigint,
  p_expected_canonical_generation bigint,
  p_checkpoint_mode text,
  p_canonical_checksum_sha256 text,
  p_canonical_record_count integer,
  p_canonical_size_bytes bigint,
  p_current_app_state_checksum_sha256 text,
  p_source text,
  p_last_profile_observed_size_bytes bigint
)
RETURNS TABLE (
  session_id uuid,
  revision_id bigint,
  state text,
  anchor_generation bigint,
  canonical_generation bigint,
  artifact_id uuid,
  artifact_checksum_sha256 text,
  artifact_size_bytes bigint,
  artifact_chunk_count integer,
  artifact_persisted_at timestamptz,
  artifact_verified_at timestamptz,
  baseline_app_state_checksum_sha256 text,
  current_app_state_checksum_sha256 text,
  app_state_overlay_required boolean,
  checkpoint_mode text,
  canonical_checksum_sha256 text,
  canonical_record_count integer,
  canonical_size_bytes bigint,
  canonical_persisted_at timestamptz,
  source text,
  last_profile_observed_size_bytes bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_active public.whatsapp_wwebjs_profile_anchor%ROWTYPE;
  v_artifact public.whatsapp_artifact%ROWTYPE;
  v_anchor_generation bigint;
  v_canonical_generation bigint;
  v_baseline_app_state_checksum_sha256 text;
  v_overlay_required boolean;
  v_chunk_count bigint;
  v_blob_count bigint;
  v_chunk_size_bytes bigint;
  v_min_chunk_index integer;
  v_max_chunk_index integer;
  v_canonical_metadata jsonb;
BEGIN
  IF p_session_id IS NULL OR p_revision_id IS NULL OR p_artifact_id IS NULL
    OR p_expected_anchor_generation IS NULL
    OR p_expected_anchor_generation < 0
    OR p_expected_canonical_generation IS NULL
    OR p_expected_canonical_generation < 0
    OR p_checkpoint_mode NOT IN (
      'legacy_adoption_v1',
      'full_profile_plus_fresh_canonical_v1',
      'immutable_profile_anchor_plus_fresh_canonical_v1',
      'last_good_plus_fresh_canonical_v1'
    )
    OR p_canonical_checksum_sha256 !~ '^[0-9a-f]{64}$'
    OR p_canonical_record_count IS NULL OR p_canonical_record_count < 0
    OR p_canonical_size_bytes IS NULL
    OR p_canonical_size_bytes NOT BETWEEN 1 AND 67108864
    OR p_current_app_state_checksum_sha256 !~ '^[0-9a-f]{64}$'
    OR p_source !~ '^[a-z][a-z0-9_]{0,63}$'
    OR (
      p_last_profile_observed_size_bytes IS NOT NULL
      AND p_last_profile_observed_size_bytes < 0
    )
  THEN
    RAISE EXCEPTION 'invalid WWebJS profile anchor checkpoint arguments'
      USING ERRCODE = '22023';
  END IF;

  IF p_session_id IS DISTINCT FROM nullif(
       current_setting('app.whatsapp_session_id', true), ''
     )::uuid
    OR p_revision_id IS DISTINCT FROM nullif(
       current_setting('app.whatsapp_revision_id', true), ''
     )::bigint
    OR nullif(current_setting('app.whatsapp_operation_abi', true), '')
       IS DISTINCT FROM 'profile-anchor-canonical-checkpoint-v1'
    OR NOT public.whatsapp_runtime_scope_is_valid()
  THEN
    RAISE EXCEPTION 'stale or unauthorized WWebJS profile anchor checkpoint'
      USING ERRCODE = '55000';
  END IF;

  PERFORM 1
  FROM public.whatsapp_session AS session
  JOIN public.whatsapp_session_revision AS revision
    ON revision.session_id = session.session_id
   AND revision.revision_id = p_revision_id
  WHERE session.session_id = p_session_id
    AND session.provider = 'wwebjs'
    AND session.state IN ('preparing', 'ready', 'handoff')
    AND session.active_revision_id = revision.revision_id
    AND revision.provider = 'wwebjs'
    AND revision.status = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WWebJS profile anchor revision is not active'
      USING ERRCODE = '55000';
  END IF;

  SELECT anchor.*
  INTO v_active
  FROM public.whatsapp_wwebjs_profile_anchor AS anchor
  WHERE anchor.session_id = p_session_id
    AND anchor.revision_id = p_revision_id
    AND anchor.state = 'active'
  FOR UPDATE OF anchor;

  IF FOUND THEN
    IF v_active.artifact_id IS DISTINCT FROM p_expected_artifact_id
      OR v_active.anchor_generation <> p_expected_anchor_generation
      OR v_active.canonical_generation <> p_expected_canonical_generation
    THEN
      RAISE EXCEPTION 'stale WWebJS profile anchor checkpoint CAS'
        USING ERRCODE = '55000';
    END IF;
  ELSIF p_expected_artifact_id IS NOT NULL
    OR p_expected_anchor_generation <> 0
    OR p_expected_canonical_generation <> 0
  THEN
    RAISE EXCEPTION 'stale WWebJS profile anchor adoption CAS'
      USING ERRCODE = '55000';
  END IF;

  BEGIN
    SELECT artifact.*
    INTO STRICT v_artifact
    FROM public.whatsapp_artifact AS artifact
    JOIN public.whatsapp_session_revision AS revision
      ON revision.session_id = artifact.session_id
     AND revision.revision_id = artifact.revision_id
    WHERE artifact.session_id = p_session_id
      AND artifact.revision_id = p_revision_id
      AND artifact.artifact_id = p_artifact_id
      AND artifact.provider = 'wwebjs'
      AND artifact.kind = 'wwebjs_profile'
      AND artifact.status = 'ready'
      AND artifact.chunk_count BETWEEN 1 AND 65536
      AND artifact.size_bytes BETWEEN 1 AND 536870912
      AND revision.provider = 'wwebjs'
      AND revision.status = 'active'
      AND revision.checksum_sha256 = artifact.checksum_sha256
      AND revision.size_bytes = artifact.size_bytes
    FOR SHARE OF artifact;
  EXCEPTION
    WHEN no_data_found OR too_many_rows THEN
      RAISE EXCEPTION 'WWebJS profile anchor artifact is missing or changed'
        USING ERRCODE = '55000';
  END;

  SELECT count(chunk.chunk_index),
         count(blob.sha256),
         COALESCE(sum(blob.size_bytes), 0),
         min(chunk.chunk_index),
         max(chunk.chunk_index)
  INTO v_chunk_count, v_blob_count, v_chunk_size_bytes,
       v_min_chunk_index, v_max_chunk_index
  FROM public.whatsapp_artifact_chunk AS chunk
  LEFT JOIN public.whatsapp_artifact_blob AS blob
    ON blob.session_id = chunk.session_id
   AND blob.sha256 = chunk.sha256
  WHERE chunk.session_id = p_session_id
    AND chunk.artifact_id = p_artifact_id;

  IF v_chunk_count <> v_artifact.chunk_count::bigint
    OR v_blob_count <> v_artifact.chunk_count::bigint
    OR v_chunk_size_bytes <> v_artifact.size_bytes
    OR v_min_chunk_index <> 0
    OR v_max_chunk_index <> v_artifact.chunk_count - 1
  THEN
    RAISE EXCEPTION 'WWebJS profile anchor artifact chunks are incomplete'
      USING ERRCODE = '55000';
  END IF;

  BEGIN
    SELECT convert_from(marker.payload, 'UTF8')::jsonb
    INTO STRICT v_canonical_metadata
    FROM public.whatsapp_provider_record AS marker
    WHERE marker.session_id = p_session_id
      AND marker.revision_id = p_revision_id
      AND marker.namespace = '_wwebjs_canonical'
      AND marker.record_key = 'v1'
      AND marker.codec_version = 1;
  EXCEPTION
    WHEN no_data_found OR too_many_rows OR invalid_text_representation THEN
      RAISE EXCEPTION 'WWebJS canonical metadata is missing or invalid'
        USING ERRCODE = '55000';
  END;

  IF jsonb_typeof(v_canonical_metadata) IS DISTINCT FROM 'object'
    OR NOT COALESCE(
      (v_canonical_metadata ->> 'record_count') ~ '^(0|[1-9][0-9]*)$',
      false
    )
    OR NOT COALESCE(
      (v_canonical_metadata ->> 'size_bytes') ~ '^(0|[1-9][0-9]*)$',
      false
    )
  THEN
    RAISE EXCEPTION 'WWebJS canonical metadata is missing or invalid'
      USING ERRCODE = '55000';
  END IF;

  BEGIN
    IF (v_canonical_metadata ->> 'record_count')::integer
         IS DISTINCT FROM p_canonical_record_count
      OR (v_canonical_metadata ->> 'size_bytes')::bigint
         IS DISTINCT FROM p_canonical_size_bytes
    THEN
      RAISE EXCEPTION 'WWebJS canonical metadata changed during checkpoint'
        USING ERRCODE = '55000';
    END IF;
  EXCEPTION
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'WWebJS canonical metadata is missing or invalid'
        USING ERRCODE = '55000';
  END;

  IF v_active.session_id IS NULL THEN
    v_anchor_generation := 1;
    v_canonical_generation := 1;
    IF p_checkpoint_mode = 'full_profile_plus_fresh_canonical_v1' THEN
      v_baseline_app_state_checksum_sha256 :=
        p_current_app_state_checksum_sha256;
      v_overlay_required := false;
    ELSE
      v_baseline_app_state_checksum_sha256 := NULL;
      v_overlay_required := true;
    END IF;

    INSERT INTO public.whatsapp_wwebjs_profile_anchor (
      session_id, revision_id, anchor_generation, artifact_id, state,
      checkpoint_mode, artifact_checksum_sha256, artifact_size_bytes,
      artifact_chunk_count, artifact_persisted_at, artifact_verified_at,
      baseline_app_state_checksum_sha256,
      current_app_state_checksum_sha256, app_state_overlay_required,
      canonical_generation, canonical_checksum_sha256,
      canonical_record_count, canonical_size_bytes, canonical_persisted_at,
      source, last_profile_observed_size_bytes, retain_until,
      created_at, updated_at
    ) VALUES (
      p_session_id, p_revision_id, v_anchor_generation, p_artifact_id,
      'active', p_checkpoint_mode, v_artifact.checksum_sha256,
      v_artifact.size_bytes, v_artifact.chunk_count,
      v_artifact.persisted_at, v_now,
      v_baseline_app_state_checksum_sha256,
      p_current_app_state_checksum_sha256, v_overlay_required,
      v_canonical_generation, p_canonical_checksum_sha256,
      p_canonical_record_count, p_canonical_size_bytes, v_now,
      p_source, p_last_profile_observed_size_bytes, NULL, v_now, v_now
    );
  ELSIF v_active.artifact_id = p_artifact_id THEN
    IF p_checkpoint_mode IN (
      'legacy_adoption_v1', 'full_profile_plus_fresh_canonical_v1'
    ) THEN
      RAISE EXCEPTION 'same WWebJS anchor requires a canonical-only mode'
        USING ERRCODE = '22023';
    END IF;

    v_anchor_generation := v_active.anchor_generation;
    v_canonical_generation := v_active.canonical_generation + 1;
    v_baseline_app_state_checksum_sha256 :=
      v_active.baseline_app_state_checksum_sha256;
    v_overlay_required :=
      v_active.app_state_overlay_required
      OR v_baseline_app_state_checksum_sha256 IS NULL
      OR v_baseline_app_state_checksum_sha256 IS DISTINCT FROM
         p_current_app_state_checksum_sha256;

    UPDATE public.whatsapp_wwebjs_profile_anchor AS anchor
    SET checkpoint_mode = p_checkpoint_mode,
        artifact_checksum_sha256 = v_artifact.checksum_sha256,
        artifact_size_bytes = v_artifact.size_bytes,
        artifact_chunk_count = v_artifact.chunk_count,
        artifact_persisted_at = v_artifact.persisted_at,
        artifact_verified_at = v_now,
        current_app_state_checksum_sha256 =
          p_current_app_state_checksum_sha256,
        app_state_overlay_required = v_overlay_required,
        canonical_generation = v_canonical_generation,
        canonical_checksum_sha256 = p_canonical_checksum_sha256,
        canonical_record_count = p_canonical_record_count,
        canonical_size_bytes = p_canonical_size_bytes,
        canonical_persisted_at = v_now,
        source = p_source,
        last_profile_observed_size_bytes =
          p_last_profile_observed_size_bytes,
        updated_at = v_now
    WHERE anchor.session_id = p_session_id
      AND anchor.revision_id = p_revision_id
      AND anchor.anchor_generation = v_active.anchor_generation
      AND anchor.state = 'active'
      AND anchor.canonical_generation = p_expected_canonical_generation;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'stale WWebJS profile anchor checkpoint CAS'
        USING ERRCODE = '55000';
    END IF;
  ELSE
    IF p_checkpoint_mode <>
       'full_profile_plus_fresh_canonical_v1'
    THEN
      RAISE EXCEPTION 'new WWebJS anchor requires a full-profile mode'
        USING ERRCODE = '22023';
    END IF;

    DELETE FROM public.whatsapp_artifact AS stale_artifact
    USING public.whatsapp_wwebjs_profile_anchor AS stale_anchor
    WHERE stale_anchor.session_id = p_session_id
      AND stale_anchor.revision_id = p_revision_id
      AND stale_anchor.state = 'previous'
      AND stale_artifact.session_id = stale_anchor.session_id
      AND stale_artifact.revision_id = stale_anchor.revision_id
      AND stale_artifact.artifact_id = stale_anchor.artifact_id
      AND stale_artifact.provider = 'wwebjs'
      AND stale_artifact.kind = 'wwebjs_profile'
      AND stale_artifact.status = 'retired'
      AND NOT EXISTS (
        SELECT 1
        FROM public.whatsapp_session_handoff AS retained_handoff
        WHERE retained_handoff.session_id = stale_anchor.session_id
          AND retained_handoff.pre_activation_artifact_id =
              stale_anchor.artifact_id
      );

    IF EXISTS (
      SELECT 1
      FROM public.whatsapp_wwebjs_profile_anchor AS previous_anchor
      WHERE previous_anchor.session_id = p_session_id
        AND previous_anchor.revision_id = p_revision_id
        AND previous_anchor.state = 'previous'
    ) THEN
      RAISE EXCEPTION
        'previous WWebJS profile anchor is still protected by a handoff'
        USING ERRCODE = '55000';
    END IF;

    UPDATE public.whatsapp_wwebjs_profile_anchor AS anchor
    SET state = 'previous',
        retain_until = v_now + interval '24 hours',
        updated_at = v_now
    WHERE anchor.session_id = p_session_id
      AND anchor.revision_id = p_revision_id
      AND anchor.anchor_generation = v_active.anchor_generation
      AND anchor.state = 'active'
      AND anchor.canonical_generation = p_expected_canonical_generation;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'stale WWebJS profile anchor rotation CAS'
        USING ERRCODE = '55000';
    END IF;

    v_anchor_generation := v_active.anchor_generation + 1;
    v_canonical_generation := v_active.canonical_generation + 1;
    v_baseline_app_state_checksum_sha256 :=
      p_current_app_state_checksum_sha256;
    v_overlay_required := false;

    INSERT INTO public.whatsapp_wwebjs_profile_anchor (
      session_id, revision_id, anchor_generation, artifact_id, state,
      checkpoint_mode, artifact_checksum_sha256, artifact_size_bytes,
      artifact_chunk_count, artifact_persisted_at, artifact_verified_at,
      baseline_app_state_checksum_sha256,
      current_app_state_checksum_sha256, app_state_overlay_required,
      canonical_generation, canonical_checksum_sha256,
      canonical_record_count, canonical_size_bytes, canonical_persisted_at,
      source, last_profile_observed_size_bytes, retain_until,
      created_at, updated_at
    ) VALUES (
      p_session_id, p_revision_id, v_anchor_generation, p_artifact_id,
      'active', p_checkpoint_mode, v_artifact.checksum_sha256,
      v_artifact.size_bytes, v_artifact.chunk_count,
      v_artifact.persisted_at, v_now,
      v_baseline_app_state_checksum_sha256,
      p_current_app_state_checksum_sha256, v_overlay_required,
      v_canonical_generation, p_canonical_checksum_sha256,
      p_canonical_record_count, p_canonical_size_bytes, v_now,
      p_source, p_last_profile_observed_size_bytes, NULL, v_now, v_now
    );
  END IF;

  DELETE FROM public.whatsapp_provider_record AS legacy_marker
  WHERE legacy_marker.session_id = p_session_id
    AND legacy_marker.revision_id = p_revision_id
    AND legacy_marker.namespace = '_wwebjs_lifecycle'
    AND legacy_marker.record_key = 'last_good_profile_anchor_v1';

  UPDATE public.whatsapp_session AS session
  SET last_persisted_at = v_now,
      updated_at = v_now
  WHERE session.session_id = p_session_id
    AND session.active_revision_id = p_revision_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WWebJS profile anchor session changed during checkpoint'
      USING ERRCODE = '55000';
  END IF;

  RETURN QUERY
  SELECT anchor.session_id,
         anchor.revision_id,
         anchor.state::text,
         anchor.anchor_generation,
         anchor.canonical_generation,
         anchor.artifact_id,
         anchor.artifact_checksum_sha256::text,
         anchor.artifact_size_bytes,
         anchor.artifact_chunk_count,
         anchor.artifact_persisted_at,
         anchor.artifact_verified_at,
         anchor.baseline_app_state_checksum_sha256::text,
         anchor.current_app_state_checksum_sha256::text,
         anchor.app_state_overlay_required,
         anchor.checkpoint_mode::text,
         anchor.canonical_checksum_sha256::text,
         anchor.canonical_record_count,
         anchor.canonical_size_bytes,
         anchor.canonical_persisted_at,
         anchor.source::text,
         anchor.last_profile_observed_size_bytes
  FROM public.whatsapp_wwebjs_profile_anchor AS anchor
  WHERE anchor.session_id = p_session_id
    AND anchor.revision_id = p_revision_id
    AND anchor.state = 'active';
END;
$function$;

REVOKE ALL ON TABLE public.whatsapp_wwebjs_profile_anchor FROM PUBLIC;
REVOKE ALL ON TABLE public.whatsapp_wwebjs_profile_anchor
  FROM whatsapp_session_runtime;
GRANT SELECT ON TABLE public.whatsapp_wwebjs_profile_anchor
  TO whatsapp_session_runtime;

REVOKE ALL ON FUNCTION public.begin_whatsapp_session_operation_v17_core(
  uuid, bigint, uuid, bigint, integer, uuid, text
) FROM PUBLIC, whatsapp_session_runtime;
REVOKE ALL ON FUNCTION public.begin_whatsapp_session_mutation_v17_core(
  uuid, bigint, uuid, bigint, integer, uuid, text
) FROM PUBLIC, whatsapp_session_runtime;
REVOKE ALL ON FUNCTION public.begin_whatsapp_session_operation(
  uuid, bigint, uuid, bigint, integer, uuid, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.begin_whatsapp_session_operation(
  uuid, bigint, uuid, bigint, integer, uuid, text, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.begin_whatsapp_session_mutation(
  uuid, bigint, uuid, bigint, integer, uuid, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.begin_whatsapp_session_mutation(
  uuid, bigint, uuid, bigint, integer, uuid, text, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.commit_wwebjs_profile_anchor_checkpoint_v1(
  uuid, bigint, uuid, uuid, bigint, bigint, text, text, integer, bigint,
  text, text, bigint
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.begin_whatsapp_session_operation(
  uuid, bigint, uuid, bigint, integer, uuid, text
) TO whatsapp_session_runtime;
GRANT EXECUTE ON FUNCTION public.begin_whatsapp_session_operation(
  uuid, bigint, uuid, bigint, integer, uuid, text, text
) TO whatsapp_session_runtime;
GRANT EXECUTE ON FUNCTION public.begin_whatsapp_session_mutation(
  uuid, bigint, uuid, bigint, integer, uuid, text
) TO whatsapp_session_runtime;
GRANT EXECUTE ON FUNCTION public.begin_whatsapp_session_mutation(
  uuid, bigint, uuid, bigint, integer, uuid, text, text
) TO whatsapp_session_runtime;
GRANT EXECUTE ON FUNCTION public.commit_wwebjs_profile_anchor_checkpoint_v1(
  uuid, bigint, uuid, uuid, bigint, bigint, text, text, integer, bigint,
  text, text, bigint
) TO whatsapp_session_runtime;

COMMENT ON TABLE public.whatsapp_wwebjs_profile_anchor IS
  'Authoritative WWebJS profile artifact anchor and canonical checkpoint generation; schema v1';
COMMENT ON FUNCTION public.begin_whatsapp_session_operation(
  uuid, bigint, uuid, bigint, integer, uuid, text, text
) IS 'WWebJS profile-anchor operation ABI: profile-anchor-canonical-checkpoint-v1';
COMMENT ON FUNCTION public.begin_whatsapp_session_mutation(
  uuid, bigint, uuid, bigint, integer, uuid, text, text
) IS 'WWebJS profile-anchor mutation ABI: profile-anchor-canonical-checkpoint-v1';
COMMENT ON FUNCTION public.commit_wwebjs_profile_anchor_checkpoint_v1(
  uuid, bigint, uuid, uuid, bigint, bigint, text, text, integer, bigint,
  text, text, bigint
) IS 'Atomically CAS-commits a verified WWebJS profile anchor plus fresh canonical authority';
