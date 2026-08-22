import { EBaileysConnectionType } from '../enums/EBaileysConnectionType';

export interface IBaileysConnection {
  type?: EBaileysConnectionType;
  initial_connection?: boolean;
  allow_restore?: boolean;
  disconnected_user?: boolean;
  phone_connection?: string;
  force_new?: boolean;
  requested_by_user?: boolean;
  from_disconnect_restart?: boolean;
  preserve_session?: boolean;
  remove_session?: boolean;
  connection_attempt_id?: string;
  /** Manager-owned epoch authorized for this exact connection attempt. */
  authorized_connection_epoch?: string;
  debug_trace_id?: string;
  runtime_generation?: number;
}
