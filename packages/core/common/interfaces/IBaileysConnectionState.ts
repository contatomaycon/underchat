import { EBaileysConnectionStatus } from '../enums/EBaileysConnectionStatus';

export interface IBaileysConnectionState {
  status: EBaileysConnectionStatus;
  worker_id: string;
  qrcode?: string;
}
