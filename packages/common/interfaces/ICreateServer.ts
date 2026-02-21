import { EServerStatus } from '../enums/EServerStatus';

export interface ICreateServer {
  server_status_id: EServerStatus;
  name: string;
  quantity_workers: number;
  proxy_enabled: boolean;
  proxy_host?: string | null;
  proxy_port?: number | null;
  proxy_username?: string | null;
  proxy_password?: string | null;
}
