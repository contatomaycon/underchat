import { EWorkerStatus } from '../enums/EWorkerStatus';
import { EWorkerType } from '../enums/EWorkerType';

export interface IViewChannelContext {
  worker_id: string;
  account_id: string;
  worker_type_id: EWorkerType;
  worker_status_id: EWorkerStatus;
  name: string;
}
