import { EServerStatus } from '../enums/EServerStatus';

export interface ICreateServer {
  server_status_id: EServerStatus;
  name: string;
}
