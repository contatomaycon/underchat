-- A protected legacy volume must remain terminally distinguishable when its
-- physical bytes are absent. This state stops automatic restore redrives and
-- never claims that the legacy session was restored.
ALTER TABLE public.whatsapp_session_storage_migration
  DROP CONSTRAINT whatsapp_session_storage_migration_state_check;

ALTER TABLE public.whatsapp_session_storage_migration
  ADD CONSTRAINT whatsapp_session_storage_migration_state_check CHECK (
    state IN (
      'queued',
      'capturing',
      'staged',
      'cutting_over',
      'starting',
      'validating',
      'retry_wait',
      'restoring',
      'recovery_required',
      'restored',
      'cleanup_pending',
      'deleting_volume',
      'completed'
    )
  );

ALTER TABLE public.whatsapp_session_storage_migration
  ADD CONSTRAINT whatsapp_session_storage_migration_recovery_required_check
  CHECK (
    state <> 'recovery_required'
    OR (
      source_volume_preserved = FALSE
      AND next_attempt_at IS NULL
      AND last_error_code = 'session_storage_migration_source_volume_missing'
    )
  );

DROP INDEX public.whatsapp_session_storage_migration_active_worker_uidx;

CREATE UNIQUE INDEX whatsapp_session_storage_migration_active_worker_uidx
ON public.whatsapp_session_storage_migration (worker_id)
WHERE state NOT IN ('recovery_required', 'restored', 'completed');

