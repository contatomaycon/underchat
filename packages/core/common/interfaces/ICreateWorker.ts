import { EWorkerStatus } from '../enums/EWorkerStatus';
import { EWorkerType } from '../enums/EWorkerType';

export interface ICreateWorker {
  worker_id: string;
  worker_status_id: EWorkerStatus;
  worker_type_id: EWorkerType;
  server_id: string;
  account_id: string;
  name: string;
  number?: string;
  container_id: string;
}
