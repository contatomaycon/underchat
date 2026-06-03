export interface IChangeConnectionStatusRequestProto {
  worker_id?: string;
  account_id?: string;
  status?: string;
  type?: string;
  phone_connection?: string;
  remove_session?: boolean;
  connection_attempt_id?: string;
  qr_pending?: boolean;
}
