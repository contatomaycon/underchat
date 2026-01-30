import { EWorkerStatus } from '../enums/EWorkerStatus';
import { EWorkerType } from '../enums/EWorkerType';

export interface IWorkerMonitor {
  worker_id: string;
  account_id: string;
  server_id: string;
  worker_status_id: EWorkerStatus;
  worker_type_id: EWorkerType;
  created_at: string | null;
  updated_at: string | null;
  deleted_at: string | null;
  container_id: string | null;
  last_connection_check_at: string | null;
}
