-- Durable, account-scoped journal for explicit legacy-volume session
-- migrations. Session material is written only to the existing provider
-- tables; this control table contains hashes, counters and sanitized health
-- evidence only.

ALTER TABLE public.whatsapp_session_revision
  DROP CONSTRAINT whatsapp_session_revision_source_check;
ALTER TABLE public.whatsapp_session_revision
  ADD CONSTRAINT whatsapp_session_revision_source_check CHECK (
    source IN (
      'pairing',
      'checkpoint',
      'secure_import',
      'handoff',
      'rollback',
      'legacy_volume_migration'
    )
  );

CREATE TABLE public.whatsapp_session_storage_migration (
  migration_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id uuid NOT NULL,
  account_id uuid NOT NULL,
  provider varchar(20) NOT NULL,
  state varchar(24) NOT NULL DEFAULT 'queued',
  source_volume_name varchar(255) NOT NULL,
  expected_phone varchar(32),
  expected_identity_hash varchar(64),
  source_runtime_generation integer NOT NULL,
  target_runtime_generation integer,
  target_revision_id bigint,
  checkpoint_checksum varchar(64),
  checkpoint_size_bytes bigint,
  checkpoint_record_count integer,
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  attempt_started_at timestamptz,
  attempt_deadline_at timestamptz,
  next_attempt_at timestamptz,
  claim_token uuid,
  claim_expires_at timestamptz,
  lifecycle_operation_id uuid,
  source_volume_preserved boolean NOT NULL DEFAULT true,
  health_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_error_code varchar(100),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  target_validated_at timestamptz,
  restored_at timestamptz,
  volume_delete_requested_at timestamptz,
  volume_deleted_at timestamptz,
  completed_at timestamptz,
  CONSTRAINT whatsapp_session_storage_migration_worker_fk
    FOREIGN KEY (worker_id) REFERENCES public.worker(worker_id)
    ON DELETE CASCADE,
  CONSTRAINT whatsapp_session_storage_migration_account_worker_fk
    FOREIGN KEY (account_id, worker_id)
    REFERENCES public.worker(account_id, worker_id)
    ON DELETE CASCADE,
  CONSTRAINT whatsapp_session_storage_migration_provider_check CHECK (
    provider IN ('baileys', 'wwebjs', 'whatsmeow')
  ),
  CONSTRAINT whatsapp_session_storage_migration_state_check CHECK (
    state IN (
      'queued', 'capturing', 'staged', 'cutting_over', 'starting',
      'validating', 'retry_wait', 'restoring', 'restored',
      'cleanup_pending', 'deleting_volume', 'completed'
    )
  ),
  CONSTRAINT whatsapp_session_storage_migration_attempt_check CHECK (
    max_attempts = 3 AND attempt_count BETWEEN 0 AND max_attempts
  ),
  CONSTRAINT whatsapp_session_storage_migration_generation_check CHECK (
    source_runtime_generation > 0
    AND (
      target_runtime_generation IS NULL
      OR target_runtime_generation > source_runtime_generation
    )
  ),
  CONSTRAINT whatsapp_session_storage_migration_checksum_check CHECK (
    checkpoint_checksum IS NULL
    OR checkpoint_checksum ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT whatsapp_session_storage_migration_identity_hash_check CHECK (
    expected_identity_hash IS NULL
    OR expected_identity_hash ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT whatsapp_session_storage_migration_size_check CHECK (
    (checkpoint_size_bytes IS NULL OR checkpoint_size_bytes >= 0)
    AND (checkpoint_record_count IS NULL OR checkpoint_record_count >= 0)
  ),
  CONSTRAINT whatsapp_session_storage_migration_evidence_check CHECK (
    jsonb_typeof(health_evidence) = 'object'
  ),
  CONSTRAINT whatsapp_session_storage_migration_terminal_check CHECK (
    (
      state = 'restored'
      AND restored_at IS NOT NULL
      AND completed_at IS NULL
    ) OR (
      state = 'completed'
      AND completed_at IS NOT NULL
      AND volume_deleted_at IS NOT NULL
    ) OR (
      state NOT IN ('restored', 'completed')
      AND completed_at IS NULL
    )
  )
);

CREATE UNIQUE INDEX whatsapp_session_storage_migration_active_worker_uidx
ON public.whatsapp_session_storage_migration(worker_id)
WHERE state NOT IN ('restored', 'completed');

CREATE INDEX whatsapp_session_storage_migration_claim_idx
ON public.whatsapp_session_storage_migration(
  next_attempt_at, updated_at, migration_id
)
WHERE state IN (
  'queued', 'capturing', 'staged', 'cutting_over', 'starting',
  'validating', 'retry_wait', 'restoring'
);

CREATE INDEX whatsapp_session_storage_migration_account_idx
ON public.whatsapp_session_storage_migration(account_id, created_at);

ALTER TABLE public.whatsapp_session_storage_migration
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_session_storage_migration
  FORCE ROW LEVEL SECURITY;

CREATE POLICY whatsapp_session_storage_migration_owner
ON public.whatsapp_session_storage_migration
FOR ALL
USING (
  current_user = pg_catalog.pg_get_userbyid((
    SELECT relation.relowner
    FROM pg_catalog.pg_class AS relation
    WHERE relation.oid = 'public.worker'::regclass
  ))
)
WITH CHECK (
  current_user = pg_catalog.pg_get_userbyid((
    SELECT relation.relowner
    FROM pg_catalog.pg_class AS relation
    WHERE relation.oid = 'public.worker'::regclass
  ))
);

CREATE POLICY whatsapp_session_storage_migration_runtime_select
ON public.whatsapp_session_storage_migration
FOR SELECT
TO whatsapp_session_runtime
USING (
  worker_id = nullif(
    current_setting('app.whatsapp_session_id', true), ''
  )::uuid
  AND migration_id = nullif(
    current_setting('app.whatsapp_storage_migration_id', true), ''
  )::uuid
  AND (SELECT public.whatsapp_runtime_scope_is_valid())
);

REVOKE ALL ON TABLE public.whatsapp_session_storage_migration FROM PUBLIC;
REVOKE ALL ON TABLE public.whatsapp_session_storage_migration
  FROM whatsapp_session_runtime;
GRANT SELECT ON TABLE public.whatsapp_session_storage_migration
  TO whatsapp_session_runtime;

COMMENT ON TABLE public.whatsapp_session_storage_migration IS
  'Control-plane journal for fenced legacy-volume to PostgreSQL migrations; never stores session credentials.';

-- The deployed revision opener remains the only generic lifecycle authority.
-- This wrapper adds one source value, and only accepts it when the exact
-- migration ID, worker, provider and target generation are journaled.
ALTER FUNCTION public.open_whatsapp_session_revision(
  uuid, uuid, text, bigint, integer, uuid, text, text, integer, integer, text
) RENAME TO open_whatsapp_session_revision_pre_legacy_migration;

REVOKE ALL ON FUNCTION public.open_whatsapp_session_revision_pre_legacy_migration(
  uuid, uuid, text, bigint, integer, uuid, text, text, integer, integer, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.open_whatsapp_session_revision_pre_legacy_migration(
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
DECLARE
  v_migration_id uuid;
  v_source text;
BEGIN
  v_source := lower(trim(p_source));

  IF v_source = 'legacy_volume_migration' THEN
    v_migration_id := nullif(
      current_setting('app.whatsapp_storage_migration_id', true), ''
    )::uuid;

    IF v_migration_id IS NULL OR NOT EXISTS (
      SELECT 1
      FROM public.whatsapp_session_storage_migration AS migration
      JOIN public.worker_runtime AS runtime
        ON runtime.worker_id = migration.worker_id
      WHERE migration.migration_id = v_migration_id
        AND migration.worker_id = p_session_id
        AND migration.provider = lower(trim(p_provider))
        AND migration.target_runtime_generation = p_generation
        AND migration.source_volume_preserved
        AND migration.state IN (
          'cutting_over', 'starting', 'validating', 'retry_wait'
        )
        AND runtime.runtime_generation = p_generation
        AND runtime.session_storage = 'postgres'
    ) THEN
      RAISE EXCEPTION 'stale or unauthorized legacy volume migration revision'
        USING ERRCODE = '55000';
    END IF;
  ELSIF v_source NOT IN (
    'pairing', 'checkpoint', 'secure_import', 'handoff', 'rollback'
  ) THEN
    RAISE EXCEPTION 'invalid whatsapp session revision source'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH opened AS (
    SELECT base.revision_id, base.status, base.handoff_id
    FROM public.open_whatsapp_session_revision_pre_legacy_migration(
      p_session_id,
      p_owner_id,
      p_provider,
      p_fencing_token,
      p_generation,
      p_epoch,
      p_capability,
      CASE WHEN v_source = 'legacy_volume_migration'
        THEN 'checkpoint'
        ELSE v_source
      END,
      p_schema_version,
      p_codec_version,
      p_format
    ) AS base
  ), marked AS (
    UPDATE public.whatsapp_session_revision AS revision
    SET source = 'legacy_volume_migration'
    FROM opened
    WHERE v_source = 'legacy_volume_migration'
      AND revision.session_id = p_session_id
      AND revision.revision_id = opened.revision_id
      AND revision.status IN ('staging', 'validating')
    RETURNING revision.revision_id
  )
  SELECT opened.revision_id, opened.status, opened.handoff_id
  FROM opened;
END;
$function$;

REVOKE ALL ON FUNCTION public.open_whatsapp_session_revision(
  uuid, uuid, text, bigint, integer, uuid, text, text, integer, integer, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.open_whatsapp_session_revision(
  uuid, uuid, text, bigint, integer, uuid, text, text, integer, integer, text
) TO whatsapp_session_runtime;

COMMENT ON FUNCTION public.open_whatsapp_session_revision(
  uuid, uuid, text, bigint, integer, uuid, text, text, integer, integer, text
) IS
  'Opens ordinary revisions compatibly and admits legacy_volume_migration only for the exact journaled target runtime.';

CREATE OR REPLACE FUNCTION public.promote_legacy_volume_migration_revision(
  p_migration_id uuid,
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
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.whatsapp_session_storage_migration AS migration
    JOIN public.worker AS worker
      ON worker.worker_id = migration.worker_id
     AND worker.account_id = migration.account_id
    JOIN public.worker_runtime AS runtime
      ON runtime.worker_id = migration.worker_id
    JOIN public.whatsapp_session_revision AS revision
      ON revision.session_id = migration.worker_id
     AND revision.revision_id = p_revision_id
    WHERE migration.migration_id = p_migration_id
      AND migration.worker_id = p_session_id
      AND migration.provider = revision.provider
      AND migration.target_runtime_generation = p_generation
      AND migration.source_volume_preserved
      AND migration.state IN (
        'cutting_over', 'starting', 'validating', 'retry_wait'
      )
      AND worker.session_storage = 'postgres'
      AND worker.deleted_at IS NULL
      AND runtime.session_storage = 'postgres'
      AND runtime.runtime_generation = p_generation
      AND revision.source = 'legacy_volume_migration'
      AND revision.status IN ('staging', 'validating', 'active')
      AND revision.writer_generation = p_generation
  ) THEN
    RAISE EXCEPTION 'legacy volume migration promotion fence is invalid'
      USING ERRCODE = '55000';
  END IF;

  RETURN public.finalize_whatsapp_session_pairing(
    p_session_id,
    p_revision_id,
    p_owner_id,
    p_fencing_token,
    p_generation,
    p_epoch,
    p_capability
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.promote_legacy_volume_migration_revision(
  uuid, uuid, bigint, uuid, bigint, integer, uuid, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.promote_legacy_volume_migration_revision(
  uuid, uuid, bigint, uuid, bigint, integer, uuid, text
) TO whatsapp_session_runtime;

COMMENT ON FUNCTION public.promote_legacy_volume_migration_revision(
  uuid, uuid, bigint, uuid, bigint, integer, uuid, text
) IS
  'Promotes the first PostgreSQL revision only for the exact durable legacy-volume migration and runtime generation.';

-- Restoration is authorized only after the control plane has switched both
-- persisted storage fences back to the exact legacy volume. This function is
-- deliberately unavailable to runtime credentials.
CREATE OR REPLACE FUNCTION public.invalidate_legacy_volume_migration_revision(
  p_migration_id uuid,
  p_worker_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_migration public.whatsapp_session_storage_migration%ROWTYPE;
BEGIN
  SELECT migration.*
  INTO v_migration
  FROM public.whatsapp_session_storage_migration AS migration
  JOIN public.worker AS worker
    ON worker.worker_id = migration.worker_id
  JOIN public.worker_runtime AS runtime
    ON runtime.worker_id = migration.worker_id
  WHERE migration.migration_id = p_migration_id
    AND migration.worker_id = p_worker_id
    AND migration.state = 'restoring'
    AND migration.source_volume_preserved
    AND worker.session_storage = 'legacy_volume'
    AND runtime.session_storage = 'legacy_volume'
    AND worker.deleted_at IS NULL
  FOR UPDATE OF migration;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'legacy volume restoration fence is invalid'
      USING ERRCODE = '55000';
  END IF;

  UPDATE public.whatsapp_session AS session
  SET state = 'empty',
      active_revision_id = NULL,
      previous_revision_id = NULL,
      active_device_fingerprint = NULL,
      last_error_at = clock_timestamp(),
      updated_at = clock_timestamp()
  WHERE session.session_id = p_worker_id
    AND EXISTS (
      SELECT 1
      FROM public.whatsapp_session_revision AS revision
      WHERE revision.session_id = session.session_id
        AND revision.revision_id = session.active_revision_id
        AND revision.source = 'legacy_volume_migration'
        AND (
          revision.revision_id = v_migration.target_revision_id
          OR (
            v_migration.target_revision_id IS NULL
            AND revision.created_at >= v_migration.created_at
            AND revision.writer_generation > v_migration.source_runtime_generation
          )
        )
    );

  UPDATE public.whatsapp_session_revision AS revision
  SET status = 'failed',
      error_code = 'legacy_volume_migration_restored',
      retired_at = clock_timestamp()
  WHERE revision.session_id = p_worker_id
    AND revision.source = 'legacy_volume_migration'
    AND revision.status IN ('staging', 'validating', 'active')
    AND (
      revision.revision_id = v_migration.target_revision_id
      OR (
        v_migration.target_revision_id IS NULL
        AND revision.created_at >= v_migration.created_at
        AND revision.writer_generation > v_migration.source_runtime_generation
      )
    );

  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.invalidate_legacy_volume_migration_revision(
  uuid, uuid
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.invalidate_legacy_volume_migration_revision(
  uuid, uuid
) FROM whatsapp_session_runtime;

COMMENT ON FUNCTION public.invalidate_legacy_volume_migration_revision(
  uuid, uuid
) IS
  'Invalidates only the candidate from an exact restoring legacy-volume migration after storage fencing returned to legacy_volume.';
