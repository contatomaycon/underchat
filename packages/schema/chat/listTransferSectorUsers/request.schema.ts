import { Static, Type } from '@sinclair/typebox';

export const listTransferSectorUsersParamsSchema = Type.Object({
  sector_id: Type.String({ format: 'uuid' }),
});

export type ListTransferSectorUsersParams = Static<
  typeof listTransferSectorUsersParamsSchema
>;

export const listTransferSectorUsersQuerySchema = Type.Object({
  channel_id: Type.Optional(Type.String({ format: 'uuid' })),
  chat_id: Type.Optional(Type.String({ format: 'uuid' })),
});

export type ListTransferSectorUsersQuery = Static<
  typeof listTransferSectorUsersQuerySchema
>;
