import { Static, Type } from '@sinclair/typebox';

export const unblockChatbotRequestSchema = Type.Object({
  chatbot_id: Type.String({ format: 'uuid' }),
});

export type UnblockChatbotRequest = Static<typeof unblockChatbotRequestSchema>;
