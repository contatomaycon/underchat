import { pagingResponseSchema } from '@core/schema/common/pagingResponseSchema';
import { Static, Type } from '@sinclair/typebox';

export const listServerSshResponseSchema = Type.Object({
  ssh_ip: Type.String(),
  ssh_port: Type.Number(),
});

export const listServerWebResponseSchema = Type.Object({
  web_domain: Type.String(),
  web_port: Type.Number(),
  web_protocol: Type.String(),
});

export const listServerResponseSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  quantity_workers: Type.Number(),
  status: Type.Object({
    id: Type.String(),
    name: Type.String(),
  }),
  ssh: listServerSshResponseSchema,
  web: listServerWebResponseSchema,
  last_sync: Type.String(),
  created_at: Type.String(),
  updated_at: Type.String(),
});

export const listServerFinalResponseSchema = Type.Object({
  ...pagingResponseSchema.properties,
  results: Type.Array(listServerResponseSchema),
});

export type ListServerResponse = Static<typeof listServerResponseSchema>;
export type ListServerFinalResponse = Static<
  typeof listServerFinalResponseSchema
>;
