import { Static, Type } from '@sinclair/typebox';

export const saveChatbotFlowConfigurationsResponseSchema = Type.Object({
  chatbot_configurations_id: Type.String(),
});

export type SaveChatbotFlowConfigurationsResponse = Static<
  typeof saveChatbotFlowConfigurationsResponseSchema
>;
