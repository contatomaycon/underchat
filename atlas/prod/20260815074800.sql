-- A storage-migration retry may encounter the exact revision that its prior
-- attempt already promoted before the lifecycle confirmation timed out. The
-- legacy wrapper must remain idempotent for that one fully materialized active
-- revision; every foreign, incomplete or handoff-backed revision still fails
-- closed.
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
  v_revision_id bigint;
  v_status text;
  v_handoff_id uuid;
  v_marked_count integer := 0;
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

  SELECT opened.revision_id, opened.status, opened.handoff_id
  INTO v_revision_id, v_status, v_handoff_id
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
  ) AS opened;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'whatsapp session revision is unavailable after open'
      USING ERRCODE = '55000';
  END IF;

  IF v_source = 'legacy_volume_migration' THEN
    UPDATE public.whatsapp_session_revision AS revision
    SET source = 'legacy_volume_migration'
    WHERE revision.session_id = p_session_id
      AND revision.revision_id = v_revision_id
      AND revision.status IN ('staging', 'validating');
    GET DIAGNOSTICS v_marked_count = ROW_COUNT;

    IF v_marked_count <> 1 AND NOT EXISTS (
      SELECT 1
      FROM public.whatsapp_session_revision AS revision
      JOIN public.whatsapp_session AS session
        ON session.session_id = revision.session_id
       AND session.active_revision_id = revision.revision_id
      WHERE revision.session_id = p_session_id
        AND revision.revision_id = v_revision_id
        AND revision.provider = lower(trim(p_provider))
        AND revision.status = 'active'
        AND revision.source = 'legacy_volume_migration'
        AND revision.schema_version = p_schema_version
        AND revision.codec_version = p_codec_version
        AND revision.format = p_format
        AND revision.checksum_sha256 IS NOT NULL
        AND revision.size_bytes > 0
        AND session.provider = lower(trim(p_provider))
        AND session.state = 'ready'
        AND v_status = 'active'
        AND v_handoff_id IS NULL
    ) THEN
      RAISE EXCEPTION 'legacy volume migration revision marking fence changed'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  RETURN QUERY SELECT v_revision_id, v_status, v_handoff_id;
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
  'Opens ordinary or fenced legacy-volume revisions and idempotently reuses only the exact fully materialized active migration revision on retry.';
