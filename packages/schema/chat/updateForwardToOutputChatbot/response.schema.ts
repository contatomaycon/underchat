import { Static, Type } from '@sinclair/typebox';

export const updateForwardToOutputChatbotResponseSchema = Type.Object({
  success: Type.Boolean(),
});

export type UpdateForwardToOutputChatbotResponse = Static<
  typeof updateForwardToOutputChatbotResponseSchema
>;
