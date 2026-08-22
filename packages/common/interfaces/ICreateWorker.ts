import { EWorkerSessionStorage } from '../enums/EWorkerSessionStorage';

export interface ICreateWorker {
  worker_id: string;
  worker_status_id: string;
  worker_type_id: string;
  server_id: string;
  account_id: string;
  name: string;
  session_storage: EWorkerSessionStorage;
  lifecycle_operation_id: string;
  recreate_available_at?: string | null;
}
