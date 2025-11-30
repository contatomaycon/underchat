import { Static, Type } from '@sinclair/typebox';

export const saveChatbotFlowResponseSchema = Type.Object({
  chatbot_flow_id: Type.String(),
});

export type SaveChatbotFlowResponse = Static<
  typeof saveChatbotFlowResponseSchema
>;
