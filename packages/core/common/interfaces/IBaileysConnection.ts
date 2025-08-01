import { EBaileysConnectionType } from '../enums/EBaileysConnectionType';

export interface IBaileysConnection {
  type?: EBaileysConnectionType;
  initial_connection?: boolean;
  allow_restore?: boolean;
  disconnected_user?: boolean;
  phone_connection?: string;
}
