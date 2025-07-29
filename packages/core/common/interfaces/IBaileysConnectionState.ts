import { EBaileysConnectionStatus } from '../enums/EBaileysConnectionStatus';

export interface IBaileysConnectionState {
  status: EBaileysConnectionStatus;
  container_name: string;
  qrcode?: string;
}
