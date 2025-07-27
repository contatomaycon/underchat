import { EWorkerStatus } from '../enums/EWorkerStatus';
import { EWorkerType } from '../enums/EWorkerType';

export interface ICreateWorker {
  worker_status_id: EWorkerStatus;
  worker_type_id: EWorkerType;
  server_id: string;
  account_id: string;
  name: string;
  number?: string;
  container_name: string;
  container_id: string;
}
