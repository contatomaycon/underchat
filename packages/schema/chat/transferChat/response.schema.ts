import { Static, Type } from '@sinclair/typebox';
import { IChat } from '@core/common/interfaces/IChat';

export const transferChatResponseSchema = Type.Object({
  chat_id: Type.String(),
  status: Type.Boolean(),
});

export type TransferChatResponse = Static<typeof transferChatResponseSchema>;
