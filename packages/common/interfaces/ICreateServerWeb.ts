import { EServerWebProtocol } from '../enums/EServerWebProtocol';

export interface ICreateServerWeb {
  web_domain: string;
  web_port: number;
  web_protocol: EServerWebProtocol;
}
