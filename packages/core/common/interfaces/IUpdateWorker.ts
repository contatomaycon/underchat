import { EWorkerStatus } from '../enums/EWorkerStatus';
import { EWorkerType } from '../enums/EWorkerType';

export interface IUpdateWorker {
  worker_id: string;
  worker_status_id: EWorkerStatus;
  worker_type_id: EWorkerType;
  container_id: string;
}
