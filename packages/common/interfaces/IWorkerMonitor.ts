import { EWorkerStatus } from '../enums/EWorkerStatus';
import { EWorkerType } from '../enums/EWorkerType';
import { EWorkerSessionStorage } from '../enums/EWorkerSessionStorage';

export interface IWorkerMonitor {
  worker_id: string;
  name: string;
  account_id: string;
  server_id: string;
  worker_status_id: EWorkerStatus;
  worker_type_id: EWorkerType;
  number?: string | null;
  connection_date?: string | null;
  session_storage?: EWorkerSessionStorage;
  created_at: string | null;
  updated_at: string | null;
  deleted_at: string | null;
  container_id: string | null;
  runtime_container_id?: string | null;
  runtime_generation?: number | null;
  connection_epoch?: string | null;
  disconnected_connection_epoch?: string | null;
  connection_disconnected_at?: string | null;
  runtime_session_volume_name?: string | null;
  recreate_bootstrap_operation_id?: string | null;
  recreate_bootstrap_runtime_generation?: number | null;
  recreate_bootstrap_container_id?: string | null;
  recreate_bootstrap_started_at?: string | null;
  recreate_retired_operation_id?: string | null;
  recreate_retired_runtime_generation?: number | null;
  recreate_retired_container_id?: string | null;
  recreate_retired_at?: string | null;
  lifecycle_operation_id: string | null;
  recreate_completed_operation_id?: string | null;
  recreate_completed_runtime_generation?: number | null;
  recreate_completed_at?: string | null;
  last_connection_check_at: string | null;
}
