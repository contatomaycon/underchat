-- A healthy recreate clears worker.lifecycle_operation_id after recording the
-- exact completed operation and generation. Restoration must accept that
-- terminal proof without weakening the active-lifecycle fence.
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
  v_runtime_generation integer;
  v_worker_updated integer := 0;
  v_runtime_updated integer := 0;
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
    AND runtime.session_volume_name = migration.source_volume_name
    AND runtime.source_provider = migration.provider
    AND runtime.runtime_generation IN (
      migration.source_runtime_generation,
      migration.target_runtime_generation
    )
    AND runtime.native_connection_public_status ->> 'provider' = migration.provider
    AND runtime.native_connection_public_status ->> 'status' = 'online'
    AND (runtime.native_connection_public_status ->> 'connected')::boolean IS TRUE
    AND (runtime.native_connection_public_status ->> 'authenticated')::boolean IS TRUE
    AND (runtime.native_connection_public_status ->> 'sessionValid')::boolean IS TRUE
    AND (runtime.native_connection_public_status ->> 'qrAvailable')::boolean IS FALSE
    AND runtime.native_connection_status ->> 'provider' = migration.provider
    AND runtime.native_connection_status ->> 'status' = 'online'
    AND (runtime.native_connection_status ->> 'connected')::boolean IS TRUE
    AND (runtime.native_connection_status ->> 'authenticated')::boolean IS TRUE
    AND (runtime.native_connection_status ->> 'sessionValid')::boolean IS TRUE
    AND (runtime.native_connection_status ->> 'qrAvailable')::boolean IS FALSE
    AND runtime.native_connection_status_source_id IS NOT NULL
    AND runtime.native_connection_status_sequence IS NOT NULL
    AND runtime.native_connection_status_outbox_id IS NOT NULL
    AND (
      worker.lifecycle_operation_id IS NOT DISTINCT FROM migration.lifecycle_operation_id
      OR (
        worker.lifecycle_operation_id IS NULL
        AND worker.recreate_completed_operation_id = migration.lifecycle_operation_id
        AND worker.recreate_completed_runtime_generation = runtime.runtime_generation
      )
    )
    AND worker.deleted_at IS NULL
  FOR UPDATE OF migration, worker, runtime;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'legacy volume restoration fence is invalid'
      USING ERRCODE = '55000';
  END IF;

  SELECT runtime.runtime_generation
  INTO STRICT v_runtime_generation
  FROM public.worker_runtime AS runtime
  WHERE runtime.worker_id = p_worker_id;

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

  UPDATE public.worker AS worker
  SET worker_status_id = (
        SELECT status.worker_status_id
        FROM public.worker_status AS status
        WHERE status.status = 'online'
        LIMIT 1
      ),
      lifecycle_operation_id = NULL,
      last_connection_check_at = clock_timestamp(),
      updated_at = clock_timestamp()
  WHERE worker.worker_id = p_worker_id
    AND worker.session_storage = 'legacy_volume'
    AND (
      worker.lifecycle_operation_id IS NOT DISTINCT FROM v_migration.lifecycle_operation_id
      OR (
        worker.lifecycle_operation_id IS NULL
        AND worker.recreate_completed_operation_id = v_migration.lifecycle_operation_id
        AND worker.recreate_completed_runtime_generation = v_runtime_generation
      )
    )
    AND worker.worker_status_id IN (
      SELECT status.worker_status_id
      FROM public.worker_status AS status
      WHERE status.status IN ('online', 'recreating')
    )
    AND worker.deleted_at IS NULL;
  GET DIAGNOSTICS v_worker_updated = ROW_COUNT;

  UPDATE public.worker_runtime AS runtime
  SET native_connection_online_acknowledged = TRUE,
      updated_at = clock_timestamp()
  WHERE runtime.worker_id = p_worker_id
    AND runtime.session_storage = 'legacy_volume'
    AND runtime.session_volume_name = v_migration.source_volume_name
    AND runtime.source_provider = v_migration.provider
    AND runtime.runtime_generation = v_runtime_generation
    AND runtime.native_connection_public_status ->> 'provider' = v_migration.provider
    AND runtime.native_connection_public_status ->> 'status' = 'online'
    AND (runtime.native_connection_public_status ->> 'connected')::boolean IS TRUE
    AND (runtime.native_connection_public_status ->> 'authenticated')::boolean IS TRUE
    AND (runtime.native_connection_public_status ->> 'sessionValid')::boolean IS TRUE
    AND (runtime.native_connection_public_status ->> 'qrAvailable')::boolean IS FALSE
    AND runtime.native_connection_status ->> 'provider' = v_migration.provider
    AND runtime.native_connection_status ->> 'status' = 'online'
    AND (runtime.native_connection_status ->> 'connected')::boolean IS TRUE
    AND (runtime.native_connection_status ->> 'authenticated')::boolean IS TRUE
    AND (runtime.native_connection_status ->> 'sessionValid')::boolean IS TRUE
    AND (runtime.native_connection_status ->> 'qrAvailable')::boolean IS FALSE
    AND runtime.native_connection_status_source_id IS NOT NULL
    AND runtime.native_connection_status_sequence IS NOT NULL
    AND runtime.native_connection_status_outbox_id IS NOT NULL;
  GET DIAGNOSTICS v_runtime_updated = ROW_COUNT;

  IF v_worker_updated <> 1 OR v_runtime_updated <> 1 THEN
    RAISE EXCEPTION 'legacy volume restoration terminal state update failed'
      USING ERRCODE = '55000';
  END IF;

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
  'Atomically invalidates a failed PostgreSQL candidate and restores the exact healthy active or completed legacy lifecycle to terminal online state.';
