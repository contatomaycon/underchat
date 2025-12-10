import { Static, Type } from '@sinclair/typebox';

export const deleteChatbotRequestSchema = Type.Object({
  chatbot_id: Type.String({ format: 'uuid' }),
});

export type DeleteChatbotRequest = Static<typeof deleteChatbotRequestSchema>;
