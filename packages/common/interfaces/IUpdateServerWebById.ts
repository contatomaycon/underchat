import { EServerWebProtocol } from '../enums/EServerWebProtocol';

export interface IUpdateServerWebById {
  server_id: string;
  web_domain: string;
  web_port: number;
  web_protocol: EServerWebProtocol;
}
