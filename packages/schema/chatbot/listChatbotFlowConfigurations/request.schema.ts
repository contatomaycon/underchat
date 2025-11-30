import { Static, Type } from '@sinclair/typebox';

export const listChatbotFlowConfigurationsRequestSchema = Type.Object({
  chatbot_id: Type.String(),
});

export type ListChatbotFlowConfigurationsRequest = Static<
  typeof listChatbotFlowConfigurationsRequestSchema
>;
