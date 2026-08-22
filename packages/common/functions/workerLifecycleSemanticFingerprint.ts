import { createSemanticFingerprint } from '@core/common/functions/createSemanticFingerprint';
import { IWorkerLifecycleQueueMessage } from '@core/common/interfaces/IWorkerLifecycleQueueMessage';

/**
 * Identifies the exact lifecycle effect while deliberately ignoring delivery
 * metadata that changes on an idempotent journal redrive.
 */
export function workerLifecycleSemanticFingerprint(
  payload: IWorkerLifecycleQueueMessage
): string {
  return createSemanticFingerprint('worker-lifecycle:v1', [
    payload.operation_id,
    payload.action,
    payload.worker_id,
    payload.account_id,
    payload.server_id,
    payload.worker_type_id,
    payload.session_storage,
    // Keep pre-conversion journals valid: only the explicit source backend
    // extends the immutable command shape. An omitted field cannot alias a
    // conversion because a conversion contributes one extra typed value.
    ...(payload.previous_session_storage === undefined
      ? []
      : [payload.previous_session_storage]),
    ...(payload.session_storage_migration_id === undefined
      ? []
      : [
          payload.session_storage_migration_id,
          payload.legacy_session_volume_name,
          payload.legacy_session_checksum,
        ]),
    payload.worker_status_id,
    payload.source,
    payload.remove_session,
    payload.remove_volume,
    payload.warm_pool_id,
    payload.previous_server_id,
    payload.previous_worker_type_id,
    payload.previous_worker_status_id,
    payload.recreate_server_slot_key,
    payload.recreate_server_slot_token,
    payload.recovery_without_journal,
    payload.cleanup_previous_runtime_required,
    payload.expected_container_id,
    payload.expected_container_started_at,
    payload.expected_container_restart_count,
    payload.expected_container_health_status,
    payload.expected_container_paused,
    payload.expected_runtime_generation,
  ]);
}

/**
 * Reproduces the lifecycle fingerprint written before `session_storage`
 * became part of the immutable command identity. It is intentionally kept
 * separate from the current fingerprint and must only be used to validate a
 * bounded, compare-and-swap migration of already persisted journals.
 */
export function legacyWorkerLifecycleSemanticFingerprintV1(
  payload: IWorkerLifecycleQueueMessage
): string {
  return createSemanticFingerprint('worker-lifecycle:v1', [
    payload.operation_id,
    payload.action,
    payload.worker_id,
    payload.account_id,
    payload.server_id,
    payload.worker_type_id,
    payload.worker_status_id,
    payload.source,
    payload.remove_session,
    payload.remove_volume,
    payload.warm_pool_id,
    payload.previous_server_id,
    payload.previous_worker_type_id,
    payload.previous_worker_status_id,
    payload.recreate_server_slot_key,
    payload.recreate_server_slot_token,
    payload.recovery_without_journal,
    payload.cleanup_previous_runtime_required,
    payload.expected_container_id,
    payload.expected_container_started_at,
    payload.expected_container_restart_count,
    payload.expected_container_health_status,
    payload.expected_container_paused,
    payload.expected_runtime_generation,
  ]);
}

/**
 * Identifies the immutable lifecycle lineage shared by the cold recovery
 * command and its single permitted phase upgrade to `activate_warm`.
 *
 * `action` and `warm_pool_id` are deliberately excluded: those are the only
 * semantic values introduced by that upgrade. Every destructive flag and
 * runtime identity remains part of the lineage.
 */
export function workerLifecyclePhaseLineageFingerprint(
  payload: IWorkerLifecycleQueueMessage
): string {
  return createSemanticFingerprint('worker-lifecycle-lineage:v1', [
    payload.operation_id,
    payload.worker_id,
    payload.account_id,
    payload.server_id,
    payload.worker_type_id,
    payload.session_storage,
    ...(payload.previous_session_storage === undefined
      ? []
      : [payload.previous_session_storage]),
    ...(payload.session_storage_migration_id === undefined
      ? []
      : [
          payload.session_storage_migration_id,
          payload.legacy_session_volume_name,
          payload.legacy_session_checksum,
        ]),
    payload.worker_status_id,
    payload.source,
    payload.remove_session,
    payload.remove_volume,
    payload.previous_server_id,
    payload.previous_worker_type_id,
    payload.previous_worker_status_id,
    payload.recreate_server_slot_key,
    payload.recreate_server_slot_token,
    payload.recovery_without_journal,
    payload.cleanup_previous_runtime_required,
    payload.expected_container_id,
    payload.expected_container_started_at,
    payload.expected_container_restart_count,
    payload.expected_container_health_status,
    payload.expected_container_paused,
    payload.expected_runtime_generation,
  ]);
}

/** See `legacyWorkerLifecycleSemanticFingerprintV1`. */
export function legacyWorkerLifecyclePhaseLineageFingerprintV1(
  payload: IWorkerLifecycleQueueMessage
): string {
  return createSemanticFingerprint('worker-lifecycle-lineage:v1', [
    payload.operation_id,
    payload.worker_id,
    payload.account_id,
    payload.server_id,
    payload.worker_type_id,
    payload.worker_status_id,
    payload.source,
    payload.remove_session,
    payload.remove_volume,
    payload.previous_server_id,
    payload.previous_worker_type_id,
    payload.previous_worker_status_id,
    payload.recreate_server_slot_key,
    payload.recreate_server_slot_token,
    payload.recovery_without_journal,
    payload.cleanup_previous_runtime_required,
    payload.expected_container_id,
    payload.expected_container_started_at,
    payload.expected_container_restart_count,
    payload.expected_container_health_status,
    payload.expected_container_paused,
    payload.expected_runtime_generation,
  ]);
}
