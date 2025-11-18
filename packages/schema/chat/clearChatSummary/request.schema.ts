import { Static, Type } from '@sinclair/typebox';

export const clearChatSummaryBodySchema = Type.Object({
  chat_ids: Type.Array(Type.String(), {
    minItems: 1,
    description: 'Array de IDs dos chats para limpar o summary',
  }),
});

export type ClearChatSummaryBody = Static<typeof clearChatSummaryBodySchema>;
