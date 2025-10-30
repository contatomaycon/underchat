import { EWorkerStatus } from '../enums/EWorkerStatus';
import { EWorkerType } from '../enums/EWorkerType';

export interface IUpdateWorker {
  worker_id: string;
  worker_status_id?: EWorkerStatus;
  worker_type_id?: EWorkerType;
  name?: string;
  number?: string;
  container_id?: string;
  connection_date?: string;
}
