import { Static, Type } from '@sinclair/typebox';

export const blockChatbotRequestSchema = Type.Object({
  chatbot_id: Type.String({ format: 'uuid' }),
});

export type BlockChatbotRequest = Static<typeof blockChatbotRequestSchema>;
