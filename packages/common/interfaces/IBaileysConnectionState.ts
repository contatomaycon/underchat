import { EBaileysConnectionStatus } from '../enums/EBaileysConnectionStatus';
import { ECodeMessage } from '../enums/ECodeMessage';
import { EWorkerStatus } from '../enums/EWorkerStatus';
import { EWorkerType } from '../enums/EWorkerType';
import { EWorkerSessionStorage } from '../enums/EWorkerSessionStorage';
import { IWhatsappConnectionStatus } from './IWhatsappConnectionStatus';
import { EWorkerAction } from '../enums/EWorkerAction';
import { EWorkerRecreatePhase } from '../enums/EWorkerRecreatePhase';

export interface IBaileysConnectionState {
  action?: EWorkerAction;
  event_type?: 'status' | 'telemetry';
  code: ECodeMessage;
  status: EBaileysConnectionStatus;
  worker_id: string;
  worker_name?: string;
  account_id: string;
  worker_type_id?: EWorkerType;
  session_storage?: EWorkerSessionStorage;
  qrcode?: string;
  is_new_login?: boolean;
  time?: number;
  phone?: string;
  disconnected_user?: boolean;
  session_removed?: boolean;
  pairing_code?: string;
  passkey_public_key?: string;
  passkey_pending?: boolean;
  passkey_confirmation_code?: string;
  passkey_skip_handoff_ux?: boolean;
  seconds_until_next_attempt?: number;
  worker_status_id?: EWorkerStatus;
  attempt?: number;
  max_attempts?: number;
  connection_attempt_id?: string;
  /** Manager-owned epoch authorized for this exact connection attempt. */
  authorized_connection_epoch?: string;
  lifecycle_operation_id?: string;
  lifecycle_source?: 'manager';
  lifecycle_action?: EWorkerAction;
  lifecycle_phase?:
    'started' | 'runtime_started' | 'runtime_retired' | 'completed';
  previous_worker_type_id?: EWorkerType;
  debug_trace_id?: string;
  qr_pending?: boolean;
  qr_generated_at?: string;
  expires_at?: string;
  recreate_available_at?: string | null;
  /** Read-only presentation phase; the durable worker status stays fenced. */
  recreate_phase?: EWorkerRecreatePhase;
  /** Durable database time at which `recreate_phase` became authoritative. */
  recreate_phase_observed_at?: string;
  /** Exact manager-owned tombstone for the current recreate runtime tuple. */
  recreate_runtime_retired?: boolean;
  recreate_completed_operation_id?: string;
  recreate_completed_runtime_generation?: number;
  recreate_completed_at?: string;
  reason?: string;
  error?: string;
  time_to_first_qr_ms?: number;
  container_id?: string;
  runtime_generation?: number;
  connection_epoch?: string;
  connection_sequence?: number;
  warm_pool_id?: string;
  proxy_status?: 'healthy' | 'unhealthy' | 'disabled';
  proxy_error_code?: string;
  proxy_fallback?: 'direct';
  proxy_bypassed?: boolean;
  session_ready?: boolean;
  can_send?: boolean;
  can_receive_runtime?: boolean;
  authenticated?: boolean;
  provider_state?: string;
  degraded_reason?: string;
  retryable?: boolean;
  last_probe_at?: string;
  probe_latency_ms?: number;
  connection_status?: IWhatsappConnectionStatus;
  connection_status_source_id?: string;
  connection_status_order?: string;
  connection_online_acknowledged?: boolean;
  /** Server observation time used to order HTTP snapshots against realtime. */
  connection_status_observed_at?: string;
  /** Durable ordering clock for the worker status projection. */
  worker_status_observed_at?: string;
}
