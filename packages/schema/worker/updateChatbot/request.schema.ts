import { Static, Type } from '@sinclair/typebox';

export const updateChatbotParamsSchema = Type.Object({
  worker_id: Type.String(),
});

export const updateChatbotRequestSchema = Type.Object({
  chatbot_id: Type.Optional(Type.String({ format: 'uuid' })),
});

export type UpdateChatbotParams = Static<typeof updateChatbotParamsSchema>;
export type UpdateChatbotRequest = Static<typeof updateChatbotRequestSchema>;
