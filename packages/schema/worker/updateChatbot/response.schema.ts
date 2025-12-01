import { Static, Type } from '@sinclair/typebox';

export const updateChatbotResponseSchema = Type.Object({
  chatbot_id: Type.Union([Type.String(), Type.Null()]),
});

export type UpdateChatbotResponse = Static<typeof updateChatbotResponseSchema>;
