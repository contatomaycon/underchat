import { EBaileysConnectionStatus } from '../enums/EBaileysConnectionStatus';
import { ECodeMessage } from '../enums/ECodeMessage';

export interface IBaileysConnectionState {
  code: ECodeMessage;
  status: EBaileysConnectionStatus;
  worker_id: string;
  qrcode?: string;
  is_new_login?: boolean;
  time?: number;
  phone?: string;
  disconnected_user?: boolean;
}
