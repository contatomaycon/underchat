import { Static, Type } from '@sinclair/typebox';

export const updateForwardToOutputChatbotParamsSchema = Type.Object({
  chat_id: Type.String({ format: 'uuid' }),
});

export const updateForwardToOutputChatbotBodySchema = Type.Object({
  forward_to_output_chatbot: Type.Boolean(),
});

export type UpdateForwardToOutputChatbotParams = Static<
  typeof updateForwardToOutputChatbotParamsSchema
>;
export type UpdateForwardToOutputChatbotRequest = Static<
  typeof updateForwardToOutputChatbotBodySchema
>;
