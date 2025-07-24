import { pagingResponseSchema } from '@core/schema/common/pagingResponseSchema';
import { Static, Type } from '@sinclair/typebox';

export const listServerSshResponseSchema = Type.Object({
  ssh_ip: Type.String(),
  ssh_port: Type.Number(),
});

export const listServerResponseSchema = Type.Object({
  name: Type.String(),
  status: Type.Object({
    id: Type.Number(),
    name: Type.String(),
  }),
  ssh: listServerSshResponseSchema,
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
