import { EProxyProtocol } from '../enums/EProxyProtocol';

export interface IUpdateServerById {
  server_id: string;
  name: string;
  quantity_workers: number;
  proxy_enabled: boolean;
  proxy_protocol?: EProxyProtocol | null;
  proxy_host?: string | null;
  proxy_port?: number | null;
  proxy_username?: string | null;
  proxy_password?: string | null;
}
