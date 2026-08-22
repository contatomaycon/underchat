-- A pre-1.0.33 Baileys legacy-volume importer could open an internal
-- Baileys -> Baileys handoff after the storage migration scaffold. The
-- restored volume was already authoritative, but the descendant
-- secure_import revision and its handoff could remain non-terminal. Close
-- only that exact, pre-activation shape after a healthy volume restoration.
CREATE OR REPLACE FUNCTION public.cleanup_restored_legacy_volume_migration_handoff()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF NEW.state <> 'restored' THEN
    RETURN NEW;
  END IF;

  UPDATE public.whatsapp_session_revision AS target
  SET status = 'failed',
      error_code = 'legacy_volume_migration_restored',
      retired_at = COALESCE(target.retired_at, clock_timestamp())
  WHERE target.session_id = NEW.worker_id
    AND target.source = 'secure_import'
    AND target.status IN ('staging', 'validating')
    AND EXISTS (
      SELECT 1
      FROM public.whatsapp_session_handoff AS handoff
      JOIN public.whatsapp_session_revision AS source
        ON source.session_id = handoff.session_id
       AND source.revision_id = handoff.source_revision_id
      JOIN public.worker AS worker
        ON worker.worker_id = handoff.session_id
      JOIN public.worker_runtime AS runtime
        ON runtime.worker_id = handoff.session_id
      JOIN public.whatsapp_session AS session
        ON session.session_id = handoff.session_id
      WHERE handoff.session_id = NEW.worker_id
        AND handoff.target_revision_id = target.revision_id
        AND handoff.source_provider = NEW.provider
        AND handoff.target_provider = NEW.provider
        AND handoff.state IN (
          'requested', 'draining', 'transforming', 'hydrating',
          'validating', 'promoting'
        )
        AND handoff.lifecycle_operation_id IS NULL
        AND handoff.point_of_no_return_at IS NULL
        AND handoff.pre_activation_artifact_id IS NULL
        AND handoff.created_at >= NEW.created_at
        AND handoff.created_at <= COALESCE(NEW.restored_at, clock_timestamp())
        AND source.source = 'legacy_volume_migration'
        AND source.status = 'failed'
        AND source.error_code = 'legacy_volume_migration_restored'
        AND source.created_at >= NEW.created_at
        AND source.writer_generation > NEW.source_runtime_generation
        AND (
          NEW.target_revision_id IS NULL
          OR source.revision_id = NEW.target_revision_id
        )
        AND worker.session_storage = 'legacy_volume'
        AND worker.lifecycle_operation_id IS NULL
        AND worker.deleted_at IS NULL
        AND runtime.session_storage = 'legacy_volume'
        AND runtime.session_volume_name = NEW.source_volume_name
        AND runtime.source_provider = NEW.provider
        AND runtime.native_connection_online_acknowledged
        AND runtime.native_connection_status ->> 'provider' = NEW.provider
        AND runtime.native_connection_status ->> 'status' = 'online'
        AND (runtime.native_connection_status ->> 'connected')::boolean IS TRUE
        AND (runtime.native_connection_status ->> 'authenticated')::boolean IS TRUE
        AND (runtime.native_connection_status ->> 'sessionValid')::boolean IS TRUE
        AND (runtime.native_connection_status ->> 'qrAvailable')::boolean IS FALSE
        AND session.state = 'empty'
        AND session.active_revision_id IS NULL
        AND session.previous_revision_id IS NULL
    );

  UPDATE public.whatsapp_session_handoff AS handoff
  SET state = 'failed',
      error_code = 'legacy_volume_migration_restored',
      updated_at = clock_timestamp(),
      completed_at = clock_timestamp()
  FROM public.whatsapp_session_revision AS source,
       public.whatsapp_session_revision AS target,
       public.worker AS worker,
       public.worker_runtime AS runtime,
       public.whatsapp_session AS session
  WHERE handoff.session_id = NEW.worker_id
    AND source.session_id = handoff.session_id
    AND source.revision_id = handoff.source_revision_id
    AND target.session_id = handoff.session_id
    AND target.revision_id = handoff.target_revision_id
    AND worker.worker_id = handoff.session_id
    AND runtime.worker_id = handoff.session_id
    AND session.session_id = handoff.session_id
    AND handoff.source_provider = NEW.provider
    AND handoff.target_provider = NEW.provider
    AND handoff.state IN (
      'requested', 'draining', 'transforming', 'hydrating',
      'validating', 'promoting'
    )
    AND handoff.lifecycle_operation_id IS NULL
    AND handoff.point_of_no_return_at IS NULL
    AND handoff.pre_activation_artifact_id IS NULL
    AND handoff.created_at >= NEW.created_at
    AND handoff.created_at <= COALESCE(NEW.restored_at, clock_timestamp())
    AND source.source = 'legacy_volume_migration'
    AND source.status = 'failed'
    AND source.error_code = 'legacy_volume_migration_restored'
    AND source.created_at >= NEW.created_at
    AND source.writer_generation > NEW.source_runtime_generation
    AND (
      NEW.target_revision_id IS NULL
      OR source.revision_id = NEW.target_revision_id
    )
    AND target.source = 'secure_import'
    AND target.status = 'failed'
    AND target.error_code = 'legacy_volume_migration_restored'
    AND worker.session_storage = 'legacy_volume'
    AND worker.lifecycle_operation_id IS NULL
    AND worker.deleted_at IS NULL
    AND runtime.session_storage = 'legacy_volume'
    AND runtime.session_volume_name = NEW.source_volume_name
    AND runtime.source_provider = NEW.provider
    AND runtime.native_connection_online_acknowledged
    AND runtime.native_connection_status ->> 'provider' = NEW.provider
    AND runtime.native_connection_status ->> 'status' = 'online'
    AND (runtime.native_connection_status ->> 'connected')::boolean IS TRUE
    AND (runtime.native_connection_status ->> 'authenticated')::boolean IS TRUE
    AND (runtime.native_connection_status ->> 'sessionValid')::boolean IS TRUE
    AND (runtime.native_connection_status ->> 'qrAvailable')::boolean IS FALSE
    AND session.state = 'empty'
    AND session.active_revision_id IS NULL
    AND session.previous_revision_id IS NULL;

  -- The generic handoff failure trigger schedules a recovery atomically. The
  -- legacy volume is already the healthy authoritative source, so cancel only
  -- the recovery just created for this exact terminalized internal handoff.
  UPDATE public.whatsapp_session_handoff AS handoff
  SET recovery_state = 'cancelled',
      recovery_cleanup_required = FALSE,
      recovery_claim_token = NULL,
      recovery_claim_expires_at = NULL,
      recovery_last_error_code = 'legacy_volume_migration_restored'
  FROM public.whatsapp_session_revision AS source,
       public.whatsapp_session_revision AS target
  WHERE handoff.session_id = NEW.worker_id
    AND source.session_id = handoff.session_id
    AND source.revision_id = handoff.source_revision_id
    AND target.session_id = handoff.session_id
    AND target.revision_id = handoff.target_revision_id
    AND handoff.source_provider = NEW.provider
    AND handoff.target_provider = NEW.provider
    AND handoff.state = 'failed'
    AND handoff.error_code = 'legacy_volume_migration_restored'
    AND handoff.recovery_state = 'pending'
    AND handoff.completed_at IS NOT NULL
    AND handoff.lifecycle_operation_id IS NULL
    AND handoff.point_of_no_return_at IS NULL
    AND handoff.pre_activation_artifact_id IS NULL
    AND handoff.created_at >= NEW.created_at
    AND handoff.created_at <= COALESCE(NEW.restored_at, clock_timestamp())
    AND source.source = 'legacy_volume_migration'
    AND source.status = 'failed'
    AND source.error_code = 'legacy_volume_migration_restored'
    AND source.created_at >= NEW.created_at
    AND source.writer_generation > NEW.source_runtime_generation
    AND (
      NEW.target_revision_id IS NULL
      OR source.revision_id = NEW.target_revision_id
    )
    AND target.source = 'secure_import'
    AND target.status = 'failed'
    AND target.error_code = 'legacy_volume_migration_restored';

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.cleanup_restored_legacy_volume_migration_handoff()
FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cleanup_restored_legacy_volume_migration_handoff()
FROM whatsapp_session_runtime;

COMMENT ON FUNCTION public.cleanup_restored_legacy_volume_migration_handoff()
IS 'Terminalizes only a pre-activation same-provider secure_import descendant after its exact healthy legacy volume migration has been restored.';

DROP TRIGGER IF EXISTS whatsapp_storage_migration_restored_handoff_cleanup
ON public.whatsapp_session_storage_migration;
CREATE TRIGGER whatsapp_storage_migration_restored_handoff_cleanup
AFTER UPDATE OF state ON public.whatsapp_session_storage_migration
FOR EACH ROW
EXECUTE FUNCTION public.cleanup_restored_legacy_volume_migration_handoff();

-- Idempotent repair for rows restored before this trigger existed. The
-- trigger itself rechecks every storage, lifecycle, native-health and
-- pre-activation fence before changing a revision or handoff.
UPDATE public.whatsapp_session_storage_migration AS migration
SET state = migration.state
WHERE migration.state = 'restored'
  AND EXISTS (
    SELECT 1
    FROM public.whatsapp_session_handoff AS handoff
    JOIN public.whatsapp_session_revision AS source
      ON source.session_id = handoff.session_id
     AND source.revision_id = handoff.source_revision_id
    JOIN public.whatsapp_session_revision AS target
      ON target.session_id = handoff.session_id
     AND target.revision_id = handoff.target_revision_id
    WHERE handoff.session_id = migration.worker_id
      AND handoff.source_provider = migration.provider
      AND handoff.target_provider = migration.provider
      AND handoff.state IN (
        'requested', 'draining', 'transforming', 'hydrating',
        'validating', 'promoting'
      )
      AND handoff.lifecycle_operation_id IS NULL
      AND handoff.point_of_no_return_at IS NULL
      AND handoff.pre_activation_artifact_id IS NULL
      AND handoff.created_at >= migration.created_at
      AND handoff.created_at <= COALESCE(migration.restored_at, clock_timestamp())
      AND source.source = 'legacy_volume_migration'
      AND source.status = 'failed'
      AND source.error_code = 'legacy_volume_migration_restored'
      AND source.created_at >= migration.created_at
      AND source.writer_generation > migration.source_runtime_generation
      AND (
        migration.target_revision_id IS NULL
        OR source.revision_id = migration.target_revision_id
      )
      AND target.source = 'secure_import'
      AND target.status IN ('staging', 'validating')
  );
