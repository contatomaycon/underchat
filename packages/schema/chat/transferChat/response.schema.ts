import { Static, Type } from '@sinclair/typebox';

export const transferChatResponseSchema = Type.Object({
  chat_id: Type.String(),
  status: Type.Boolean(),
});

export type TransferChatResponse = Static<typeof transferChatResponseSchema>;
