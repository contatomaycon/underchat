import { EWorkerStatus } from '../enums/EWorkerStatus';

export type WorkerLifecycleAckStatus = 'queued';

export interface IWorkerLifecycleAck {
  code: 202;
  status: WorkerLifecycleAckStatus;
  queued: true;
  worker_id: string;
  account_id: string;
  server_id?: string;
  worker_type_id?: string;
  worker_status_id: EWorkerStatus;
  operation_id: string;
  reason: string;
  recreate_available_at?: string | null;
}
