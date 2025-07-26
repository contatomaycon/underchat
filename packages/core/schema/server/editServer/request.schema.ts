import { Static, Type } from '@sinclair/typebox';

export const editServerRequestSchema = Type.Object({
  name: Type.String(),
  quantity_workers: Type.Number(),
  ssh_ip: Type.String(),
  ssh_port: Type.Number(),
  ssh_username: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  ssh_password: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export const editServerParamsRequestSchema = Type.Object({
  server_id: Type.Number(),
});

export type EditServerRequest = Static<typeof editServerRequestSchema>;
export type EditServerParamsRequest = Static<
  typeof editServerParamsRequestSchema
>;
