import { EWorkerStatus } from '../enums/EWorkerStatus';
import { EWorkerType } from '../enums/EWorkerType';

export interface ICreateWorker {
  worker_status_id: EWorkerStatus;
  worker_type_id: EWorkerType;
  server_id: number;
  account_id: number;
  name: string;
  container_id: string;
}
