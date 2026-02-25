import { EServerStatus } from '../enums/EServerStatus';
import { EProxyProtocol } from '../enums/EProxyProtocol';

export interface ICreateServer {
  server_status_id: EServerStatus;
  name: string;
  quantity_workers: number;
  proxy_enabled: boolean;
  proxy_protocol?: EProxyProtocol | null;
  proxy_host?: string | null;
  proxy_port?: number | null;
  proxy_username?: string | null;
  proxy_password?: string | null;
}
