import { Static, Type } from '@sinclair/typebox';

export const viewChatbotResponseSchema = Type.Object({
  chatbot_id: Type.Union([Type.String(), Type.Null()]),
  output_chatbot_id: Type.Union([Type.String(), Type.Null()]),
  enabled: Type.Boolean(),
});

export type ViewChatbotResponse = Static<typeof viewChatbotResponseSchema>;
