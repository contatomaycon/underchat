export type WorkerConnectionQrCodeQueueSource = 'manager' | 'external';

export interface IWorkerConnectionQrCodeQueueMessage {
  request_id: string;
  connection_attempt_id: string;
  worker_id: string;
  account_id: string;
  worker_type_id: string;
  runtime_generation?: number;
  /** Manager-owned epoch that identifies this exact connection attempt. */
  authorized_connection_epoch?: string;
  debug_trace_id?: string;
  source: WorkerConnectionQrCodeQueueSource;
  requested_at: string;
  expires_at?: string;
}
