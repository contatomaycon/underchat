import { EWorkerAction } from '../enums/EWorkerAction';
import { EWorkerStatus } from '../enums/EWorkerStatus';
import { EWorkerType } from '../enums/EWorkerType';

export interface IWorkerPayload {
  action: EWorkerAction;
  worker_id: string;
  server_id: string;
  account_id: string;
  worker_status_id?: EWorkerStatus;
  worker_type_id?: EWorkerType;
  name?: string;
  previous_worker_status_id?: EWorkerStatus;
  remove_session?: boolean;
  remove_volume?: boolean;
}
