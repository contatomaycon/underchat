import { EWorkerSessionStorage } from '../enums/EWorkerSessionStorage';

export interface IWorkerRuntime {
  worker_id: string;
  container_id?: string | null;
  container_name?: string | null;
  session_storage: EWorkerSessionStorage;
  session_volume_name: string | null;
  runtime_generation: number;
  runtime_capability_hash?: string | null;
  session_writer_epoch?: string | null;
  connection_epoch?: string | null;
  disconnected_connection_epoch?: string | null;
  connection_disconnected_at?: string | null;
  connection_sequence: number;
  source_provider?: string | null;
  connection_activated_at?: string | null;
  recreate_bootstrap_operation_id?: string | null;
  recreate_bootstrap_runtime_generation?: number | null;
  recreate_bootstrap_container_id?: string | null;
  recreate_bootstrap_started_at?: string | null;
  recreate_retired_operation_id?: string | null;
  recreate_retired_runtime_generation?: number | null;
  recreate_retired_container_id?: string | null;
  recreate_retired_at?: string | null;
  warm_pool_id?: string | null;
  activated_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}
