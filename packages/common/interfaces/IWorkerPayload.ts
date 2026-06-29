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
  worker_name?: string;
  previous_worker_type_id?: EWorkerType;
  previous_worker_status_id?: EWorkerStatus;
  remove_session?: boolean;
  remove_volume?: boolean;
  lifecycle_operation_id?: string;
  recreate_available_at?: string | null;
  recreate_server_slot_key?: string;
  recreate_server_slot_token?: string;
  debug_trace_id?: string;
}
