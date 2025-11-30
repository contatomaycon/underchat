import { Static, Type } from '@sinclair/typebox';

export const listChatbotFlowRequestSchema = Type.Object({
  chatbot_id: Type.String(),
});

export type ListChatbotFlowRequest = Static<
  typeof listChatbotFlowRequestSchema
>;
