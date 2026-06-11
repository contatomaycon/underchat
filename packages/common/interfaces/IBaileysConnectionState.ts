import { EBaileysConnectionStatus } from '../enums/EBaileysConnectionStatus';
import { ECodeMessage } from '../enums/ECodeMessage';
import { EWorkerStatus } from '../enums/EWorkerStatus';
import { EWorkerType } from '../enums/EWorkerType';

export interface IBaileysConnectionState {
  code: ECodeMessage;
  status: EBaileysConnectionStatus;
  worker_id: string;
  account_id: string;
  worker_type_id?: EWorkerType;
  qrcode?: string;
  is_new_login?: boolean;
  time?: number;
  phone?: string;
  disconnected_user?: boolean;
  pairing_code?: string;
  seconds_until_next_attempt?: number;
  worker_status_id?: EWorkerStatus;
  attempt?: number;
  max_attempts?: number;
  connection_attempt_id?: string;
  connection_lifecycle_id?: string;
  qr_pending?: boolean;
  qr_generated_at?: string;
  expires_at?: string;
  reason?: string;
  error?: string;
  time_to_first_qr_ms?: number;
  container_id?: string;
  runtime_generation?: number;
  warm_pool_id?: string;
  proxy_status?: 'healthy' | 'unhealthy' | 'disabled';
  proxy_error_code?: string;
  proxy_fallback?: 'direct';
  proxy_bypassed?: boolean;
}
