import { Static, Type } from '@sinclair/typebox';

export const listMessageChatsQuerySchema = Type.Object({
  from: Type.Optional(Type.Number({ default: 0 })),
  size: Type.Optional(Type.Number({ default: 100 })),
});

export const listMessageChatsParamsSchema = Type.Object({
  chat_id: Type.String(),
});

export type ListMessageChatsQuery = Static<typeof listMessageChatsQuerySchema>;
export type ListMessageChatsParams = Static<
  typeof listMessageChatsParamsSchema
>;
