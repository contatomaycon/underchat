import { EWorkerAction } from '../enums/EWorkerAction';
import { EWorkerStatus } from '../enums/EWorkerStatus';
import { EWorkerType } from '../enums/EWorkerType';
import { EWorkerSessionStorage } from '../enums/EWorkerSessionStorage';

export type WorkerLifecycleQueueAction =
  | 'create'
  | 'recreate'
  | 'activate_warm'
  | 'cleanup_previous_runtime'
  | 'delete';

export type WorkerLifecycleQueueSource =
  | 'worker_create'
  | 'worker_recreate'
  | 'worker_update'
  | 'config_recreate'
  | 'reset_connection'
  | 'self_heal'
  | 'plan_limit_enforcement'
  | 'plan_cancellation'
  | 'channel_delete'
  | 'worker_delete';

export interface IWorkerLifecycleQueueMessage {
  request_id: string;
  operation_id: string;
  action: WorkerLifecycleQueueAction;
  worker_id: string;
  account_id: string;
  server_id: string;
  worker_type_id?: EWorkerType;
  session_storage?: EWorkerSessionStorage;
  previous_session_storage?: EWorkerSessionStorage;
  /** Immutable identity for a protected legacy-volume <-> PostgreSQL cutover. */
  session_storage_migration_id?: string;
  legacy_session_volume_name?: string;
  legacy_session_checksum?: string;
  worker_status_id?: EWorkerStatus;
  source: WorkerLifecycleQueueSource;
  remove_session?: boolean;
  remove_volume?: boolean;
  warm_pool_id?: string;
  previous_server_id?: string;
  previous_worker_type_id?: EWorkerType;
  previous_worker_status_id?: EWorkerStatus;
  cleanup_previous_runtime_required?: boolean;
  recreate_server_slot_key?: string;
  recreate_server_slot_token?: string;
  recovery_without_journal?: boolean;
  expected_container_id?: string;
  expected_container_started_at?: string;
  expected_container_restart_count?: number;
  expected_container_health_status?: string;
  expected_container_paused?: boolean;
  expected_runtime_generation?: number;
  /**
   * Ephemeral ownership proof for a journal redrive delivery. It is excluded
   * from the immutable lifecycle fingerprint and is never persisted in the
   * journal. A consumer may release only this exact claim when it discovers
   * that the original lifecycle execution still owns the worker lock.
   */
  redrive_claim_token?: string;
  debug_trace_id?: string;
  requested_at: string;
}

export function workerLifecycleQueueActionToWorkerAction(
  action: WorkerLifecycleQueueAction
): EWorkerAction {
  if (action === 'delete') {
    return EWorkerAction.delete;
  }

  if (action === 'cleanup_previous_runtime') {
    return EWorkerAction.cleanup;
  }

  if (action === 'recreate') {
    return EWorkerAction.recreate;
  }

  return EWorkerAction.create;
}
