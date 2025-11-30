import { Static, Type } from '@sinclair/typebox';

export const updateChatbotParamsRequestSchema = Type.Object({
  chatbot_id: Type.String({ format: 'uuid' }),
});

export type UpdateChatbotParamsRequest = Static<
  typeof updateChatbotParamsRequestSchema
>;

export const updateChatbotRequestSchema = Type.Object({
  name: Type.String(),
});

export type UpdateChatbotRequest = Static<typeof updateChatbotRequestSchema>;
