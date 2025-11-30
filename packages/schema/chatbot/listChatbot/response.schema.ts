import { Static, Type } from '@sinclair/typebox';

export const listChatbotResponseSchema = Type.Object({
  chatbot_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  created_at: Type.String(),
});

export type ListChatbotResponse = Static<typeof listChatbotResponseSchema>;
