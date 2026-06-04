export interface INotifyWorkerStatusRequestProto {
  worker_id?: string;
  account_id?: string;
  worker_status_id?: string;
  phone?: string;
  disconnected_user?: boolean;
  connection_attempt_id?: string;
}
