import { EWorkerStatus } from '../enums/EWorkerStatus';

export interface IRecreateWorker {
  worker_id: string;
  server_id: string;
  account_id: string;
  worker_status_id: EWorkerStatus;
  is_administrator: boolean;
}
