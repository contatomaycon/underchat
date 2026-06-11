export type WorkerConnectionQrCodeQueueSource = 'manager' | 'external';

export interface IWorkerConnectionQrCodeQueueMessage {
  request_id: string;
  connection_attempt_id: string;
  connection_lifecycle_id: string;
  worker_id: string;
  account_id: string;
  worker_type_id: string;
  runtime_generation?: number;
  source: WorkerConnectionQrCodeQueueSource;
  requested_at: string;
  expires_at?: string;
}
