export interface IWorkerPayloadProto {
  action?: string;
  worker_id?: string;
  server_id?: string;
  account_id?: string;
  worker_status_id?: string;
  worker_type_id?: string;
  name?: string;
  previous_worker_status_id?: string;
  remove_session?: boolean;
  remove_volume?: boolean;
  lifecycle_operation_id?: string;
}
