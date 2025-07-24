import { pagingRequestSchema } from '@core/schema/common/pagingRequestSchema';
import { sortRequestSchema } from '@core/schema/common/sortRequestSchema';
import { Static, Type } from '@sinclair/typebox';

export const listServerRequestSchema = Type.Object({
  ...pagingRequestSchema.properties,
  sort_by: Type.Optional(Type.Array(sortRequestSchema)),
  server_name: Type.Optional(Type.String()),
  server_status_id: Type.Optional(Type.Number()),
  ssh_ip: Type.Optional(Type.String()),
  ssh_port: Type.Optional(Type.Number()),
});

export type ListServerRequest = Static<typeof listServerRequestSchema>;
