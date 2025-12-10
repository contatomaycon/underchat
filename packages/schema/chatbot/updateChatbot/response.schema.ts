import { Static, Type } from '@sinclair/typebox';

export const updateChatbotResponseSchema = Type.Object({
  chatbot_id: Type.String(),
  name: Type.String(),
  updated_at: Type.String(),
});

export type UpdateChatbotResponse = Static<typeof updateChatbotResponseSchema>;
