export interface IChangeConnectionStatusRequestProto {
  worker_id?: string;
  account_id?: string;
  status?: string;
  type?: string;
  phone_connection?: string;
  remove_session?: boolean;
  connection_attempt_id?: string;
  debug_trace_id?: string;
  runtime_generation?: number | string;
  warm_pool_id?: string;
  qr_pending?: boolean;
  proxy_status?: string;
  proxy_error_code?: string;
  proxy_fallback?: string;
  proxy_bypassed?: boolean;
}
