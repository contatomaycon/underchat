import { EBaileysConnectionStatus } from '../enums/EBaileysConnectionStatus';
import { ECodeMessage } from '../enums/ECodeMessage';
import { EWorkerStatus } from '../enums/EWorkerStatus';

export interface IBaileysConnectionState {
  code: ECodeMessage;
  status: EBaileysConnectionStatus;
  worker_id: string;
  account_id: string;
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
  qr_pending?: boolean;
}
