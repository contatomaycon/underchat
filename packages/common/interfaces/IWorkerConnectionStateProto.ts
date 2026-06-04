export interface IWorkerConnectionStateProto {
  code?: number;
  status?: string;
  worker_id?: string;
  account_id?: string;
  qrcode?: string;
  is_new_login?: boolean;
  time?: number | string;
  phone?: string;
  disconnected_user?: boolean;
  pairing_code?: string;
  seconds_until_next_attempt?: number;
  worker_status_id?: string;
  attempt?: number;
  max_attempts?: number;
  connection_attempt_id?: string;
  qr_pending?: boolean;
  qr_generated_at?: string;
  proxy_status?: string;
  proxy_error_code?: string;
  proxy_fallback?: string;
  proxy_bypassed?: boolean;
}
