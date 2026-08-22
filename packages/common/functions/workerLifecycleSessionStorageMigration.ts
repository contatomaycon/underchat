import { EWorkerSessionStorage } from '@core/common/enums/EWorkerSessionStorage';
import type { IWorkerLifecycleQueueMessage } from '@core/common/interfaces/IWorkerLifecycleQueueMessage';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CHECKSUM_PATTERN = /^[0-9a-f]{64}$/u;

export function hasWorkerLifecycleSessionStorageMigrationMetadata(
  payload: IWorkerLifecycleQueueMessage
): boolean {
  return (
    payload.session_storage_migration_id !== undefined ||
    payload.legacy_session_volume_name !== undefined ||
    payload.legacy_session_checksum !== undefined
  );
}

/**
 * Authorizes only a provider-preserving, non-destructive storage migration.
 * The immutable migration identity prevents an ordinary lifecycle command
 * from being widened into a volume <-> PostgreSQL cutover during redrive.
 */
export function isProtectedWorkerLifecycleSessionStorageMigration(
  payload: IWorkerLifecycleQueueMessage
): boolean {
  const changesStorage =
    (payload.previous_session_storage === EWorkerSessionStorage.legacy_volume &&
      payload.session_storage === EWorkerSessionStorage.postgres) ||
    (payload.previous_session_storage === EWorkerSessionStorage.postgres &&
      payload.session_storage === EWorkerSessionStorage.legacy_volume);

  return Boolean(
    payload.action === 'recreate' &&
    payload.source === 'worker_update' &&
    changesStorage &&
    typeof payload.worker_type_id === 'string' &&
    payload.previous_worker_type_id === payload.worker_type_id &&
    payload.previous_server_id === undefined &&
    payload.remove_session === false &&
    payload.remove_volume === false &&
    payload.cleanup_previous_runtime_required !== true &&
    typeof payload.session_storage_migration_id === 'string' &&
    UUID_PATTERN.test(payload.session_storage_migration_id) &&
    typeof payload.legacy_session_volume_name === 'string' &&
    payload.legacy_session_volume_name.length > 0 &&
    payload.legacy_session_volume_name.length <= 255 &&
    !/[\\/\u0000]/u.test(payload.legacy_session_volume_name) &&
    typeof payload.legacy_session_checksum === 'string' &&
    CHECKSUM_PATTERN.test(payload.legacy_session_checksum)
  );
}

/**
 * Identifies the second, PostgreSQL-only recreate that proves the promoted
 * revision can boot without the legacy volume. It carries only the immutable
 * migration id: forwarding the source volume/checksum here would accidentally
 * remount the rollback volume and turn the detach proof into another import.
 */
export function isProtectedWorkerLifecycleSessionStorageMigrationFinalization(
  payload: IWorkerLifecycleQueueMessage
): boolean {
  return Boolean(
    payload.action === 'recreate' &&
    payload.source === 'worker_update' &&
    payload.session_storage === EWorkerSessionStorage.postgres &&
    payload.previous_session_storage === undefined &&
    typeof payload.worker_type_id === 'string' &&
    payload.previous_worker_type_id === payload.worker_type_id &&
    payload.previous_server_id === undefined &&
    payload.remove_session === false &&
    payload.remove_volume === false &&
    payload.cleanup_previous_runtime_required !== true &&
    typeof payload.session_storage_migration_id === 'string' &&
    UUID_PATTERN.test(payload.session_storage_migration_id) &&
    payload.legacy_session_volume_name === undefined &&
    payload.legacy_session_checksum === undefined
  );
}
