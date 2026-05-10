import { Static, Type } from '@sinclair/typebox';

export const listChatbotUsersQuerySchema = Type.Object({
  channel_id: Type.Optional(Type.String({ format: 'uuid' })),
});

export type ListChatbotUsersQuery = Static<typeof listChatbotUsersQuerySchema>;
