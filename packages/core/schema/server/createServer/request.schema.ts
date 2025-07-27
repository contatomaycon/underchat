import { EServerWebProtocol } from '@core/common/enums/EServerWebProtocol';
import { Static, Type } from '@sinclair/typebox';

export const createServerRequestSchema = Type.Object({
  name: Type.String(),
  quantity_workers: Type.Number(),
  ssh_ip: Type.String(),
  ssh_port: Type.Number(),
  ssh_username: Type.String(),
  ssh_password: Type.String(),
  web_domain: Type.String(),
  web_port: Type.Number(),
  web_protocol: Type.String({ enum: Object.values(EServerWebProtocol) }),
});

export type CreateServerRequest = Static<typeof createServerRequestSchema>;
