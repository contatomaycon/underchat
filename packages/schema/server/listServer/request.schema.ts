import { pagingRequestSchema } from '@core/schema/common/pagingRequestSchema';
import { sortRequestSchema } from '@core/schema/common/sortRequestSchema';
import { Static, Type } from '@sinclair/typebox';

export const listServerRequestSchema = Type.Object({
  ...pagingRequestSchema.properties,
  sort_by: Type.Optional(Type.Array(sortRequestSchema)),
  server_name: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  server_status_id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  ssh_ip: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  web_domain: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export type ListServerRequest = Static<typeof listServerRequestSchema>;
