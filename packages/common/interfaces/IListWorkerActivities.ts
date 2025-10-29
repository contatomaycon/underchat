import { EWorkerStatus } from '../enums/EWorkerStatus';

export interface IListWorkerActivities {
  worker_id: string;
  server_id: string;
  account_id: string;
  worker_status_id: EWorkerStatus;
  number: number | null;
  connection_date: string | null;
}
