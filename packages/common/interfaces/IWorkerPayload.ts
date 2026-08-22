import { EWorkerAction } from '../enums/EWorkerAction';
import { EWorkerStatus } from '../enums/EWorkerStatus';
import { EWorkerType } from '../enums/EWorkerType';
import { EWorkerSessionStorage } from '../enums/EWorkerSessionStorage';

export interface IWorkerPayload {
  action: EWorkerAction;
  worker_id: string;
  server_id: string;
  /**
   * Source server for an authorized PostgreSQL provider handoff. The target
   * `server_id` stays authoritative; this is used only to prove the retired
   * source container identity if it is still present during target cleanup.
   */
  previous_server_id?: string;
  account_id: string;
  worker_status_id?: EWorkerStatus;
  worker_type_id?: EWorkerType;
  session_storage?: EWorkerSessionStorage;
  /**
   * Source backend for an explicitly journaled storage transition. The
   * target `session_storage` remains authoritative for the replacement
   * runtime. Destructive reset and protected migration semantics are fenced
   * independently by their flags and immutable migration identity.
   */
  previous_session_storage?: EWorkerSessionStorage;
  session_storage_migration_id?: string;
  legacy_session_volume_name?: string;
  legacy_session_checksum?: string;
  name?: string;
  worker_name?: string;
  previous_worker_type_id?: EWorkerType;
  previous_worker_status_id?: EWorkerStatus;
  remove_session?: boolean;
  remove_volume?: boolean;
  lifecycle_operation_id?: string;
  recreate_available_at?: string | null;
  recreate_server_slot_key?: string;
  recreate_server_slot_token?: string;
  recovery_without_journal?: boolean;
  expected_container_id?: string;
  expected_container_started_at?: string;
  expected_container_restart_count?: number;
  expected_container_health_status?: string;
  expected_container_paused?: boolean;
  expected_runtime_generation?: number;
  lifecycle_semantic_fingerprint?: string;
  debug_trace_id?: string;
}
