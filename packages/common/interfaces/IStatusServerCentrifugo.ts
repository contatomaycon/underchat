import { EServerStatus } from '../enums/EServerStatus';

export interface IStatusServerCentrifugo {
  server_id: string;
  status: EServerStatus;
  last_sync?: string | null;
}
