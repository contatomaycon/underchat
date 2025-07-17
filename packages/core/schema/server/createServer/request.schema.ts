import { Static, Type } from '@sinclair/typebox';

export const createServerRequestSchema = Type.Object({
  name: Type.String(),
  ssh_ip: Type.String(),
  ssh_port: Type.Number(),
  ssh_username: Type.String(),
  ssh_password: Type.String(),
});

export type CreateServerRequest = Static<typeof createServerRequestSchema>;
