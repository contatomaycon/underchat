import { EWorkerWarmPoolState } from '@core/common/enums/EWorkerWarmPoolState';
import { EWorkerSessionStorage } from '@core/common/enums/EWorkerSessionStorage';

export interface IWorkerWarmPool {
  warm_pool_id: string;
  server_id: string;
  worker_type_id: string;
  container_id?: string | null;
  container_name?: string | null;
  session_storage: EWorkerSessionStorage;
  session_volume_name: string | null;
  runtime_generation: number;
  runtime_capability_hash?: string | null;
  session_writer_epoch?: string | null;
  state: EWorkerWarmPoolState;
  reserved_by_worker_id?: string | null;
  reservation_expires_at?: string | null;
  last_health_at?: string | null;
  last_error?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface IWorkerWarmPoolReadyCount {
  server_id: string;
  worker_type_id: string;
  ready_count: number;
}
