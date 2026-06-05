import { EWorkerWarmPoolState } from '@core/common/enums/EWorkerWarmPoolState';

export interface IWorkerWarmPool {
  warm_pool_id: string;
  server_id: string;
  worker_type_id: string;
  container_id?: string | null;
  container_name?: string | null;
  session_volume_name: string;
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
