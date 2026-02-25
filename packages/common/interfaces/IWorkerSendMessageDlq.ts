export interface IWorkerSendMessageDlq {
  worker_id: string;
  topic: string;
  partition: number;
  offset: number;
  chat_id: string | null;
  queue_key: string;
  attempts: number;
  error: string;
  payload: unknown;
  raw_payload: string | null;
  failed_at: string;
}
