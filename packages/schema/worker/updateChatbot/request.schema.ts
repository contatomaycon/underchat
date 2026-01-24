import { Static, Type } from '@sinclair/typebox';

export const updateChatbotParamsSchema = Type.Object({
  worker_id: Type.String(),
});

export const updateChatbotRequestSchema = Type.Object({
  chatbot_id: Type.Optional(
    Type.Union([Type.String({ format: 'uuid' }), Type.Null()])
  ),
  output_chatbot_id: Type.Optional(
    Type.Union([Type.String({ format: 'uuid' }), Type.Null()])
  ),
  enabled: Type.Boolean(),
});

export type UpdateChatbotParams = Static<typeof updateChatbotParamsSchema>;
export type UpdateChatbotRequest = Static<typeof updateChatbotRequestSchema>;
