import { Static, Type } from '@sinclair/typebox';

export const createMessageChatsParamsSchema = Type.Object({
  chat_id: Type.String(),
});

export const createMessageChatsBodySchema = Type.Object({
  worker_id: Type.String(),
  message: Type.String(),
});

export type CreateMessageChatsParams = Static<
  typeof createMessageChatsParamsSchema
>;
export type CreateMessageChatsBody = Static<
  typeof createMessageChatsBodySchema
>;
