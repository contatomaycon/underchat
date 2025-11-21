import { Static, Type } from '@sinclair/typebox';

export const viewServerSshResponseSchema = Type.Object({
  ssh_ip: Type.String(),
  ssh_port: Type.Number(),
});

export const viewServerWebResponseSchema = Type.Object({
  web_domain: Type.String(),
  web_port: Type.Number(),
  web_protocol: Type.String(),
});

export const viewServerResponseSchema = Type.Object({
  name: Type.String(),
  quantity_workers: Type.Number(),
  status: Type.Object({
    id: Type.String(),
    name: Type.String(),
  }),
  ssh: viewServerSshResponseSchema,
  web: viewServerWebResponseSchema,
  created_at: Type.String(),
  updated_at: Type.String(),
});

export type ViewServerResponse = Static<typeof viewServerResponseSchema>;
