import { EWorkerAction } from '../enums/EWorkerAction';
import { EWorkerStatus } from '../enums/EWorkerStatus';
import { EWorkerType } from '../enums/EWorkerType';

export type WorkerLifecycleQueueAction =
  | 'create'
  | 'recreate'
  | 'activate_warm'
  | 'cleanup_previous_runtime';

export type WorkerLifecycleQueueSource =
  | 'worker_create'
  | 'worker_recreate'
  | 'worker_update'
  | 'config_recreate'
  | 'reset_connection';

export interface IWorkerLifecycleQueueMessage {
  request_id: string;
  operation_id: string;
  action: WorkerLifecycleQueueAction;
  worker_id: string;
  account_id: string;
  server_id: string;
  worker_type_id?: EWorkerType;
  worker_status_id?: EWorkerStatus;
  source: WorkerLifecycleQueueSource;
  remove_session?: boolean;
  remove_volume?: boolean;
  warm_pool_id?: string;
  previous_server_id?: string;
  previous_worker_type_id?: EWorkerType;
  previous_worker_status_id?: EWorkerStatus;
  requested_at: string;
}

export function workerLifecycleQueueActionToWorkerAction(
  action: WorkerLifecycleQueueAction
): EWorkerAction {
  if (action === 'cleanup_previous_runtime') {
    return EWorkerAction.cleanup;
  }

  if (action === 'recreate') {
    return EWorkerAction.recreate;
  }

  return EWorkerAction.create;
}
