import { ESortByServer } from '@core/common/enums/ESortByServer';
import { ESortOrder } from '@core/common/enums/ESortOrder';
import { pagingRequestSchema } from '@core/schema/common/pagingRequestSchema';
import { Static, Type } from '@sinclair/typebox';

export const listServerRequestSchema = Type.Object({
  ...pagingRequestSchema.properties,
  sort_by: Type.Optional(Type.String({ enum: Object.values(ESortByServer) })),
  sort_order: Type.Optional(Type.String({ enum: Object.values(ESortOrder) })),
  server_name: Type.Optional(Type.String()),
  server_status_id: Type.Optional(Type.Number()),
  ssh_ip: Type.Optional(Type.String()),
  ssh_port: Type.Optional(Type.Number()),
});

export type ListServerRequest = Static<typeof listServerRequestSchema>;
