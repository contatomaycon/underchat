import { Static, Type } from '@sinclair/typebox';

export const listChatbotSectorUsersParamsSchema = Type.Object({
  sector_id: Type.String({ format: 'uuid' }),
});

export type ListChatbotSectorUsersParams = Static<
  typeof listChatbotSectorUsersParamsSchema
>;

export const listChatbotSectorUsersQuerySchema = Type.Object({
  channel_id: Type.Optional(Type.String({ format: 'uuid' })),
});

export type ListChatbotSectorUsersQuery = Static<
  typeof listChatbotSectorUsersQuerySchema
>;
