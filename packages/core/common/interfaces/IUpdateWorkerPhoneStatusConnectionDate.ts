import { EWorkerStatus } from '../enums/EWorkerStatus';

export interface IUpdateWorkerPhoneStatusConnectionDate {
  worker_id: string;
  number: string | null;
  status: EWorkerStatus;
  connection_date?: string | null;
}
