import { Static, Type } from '@sinclair/typebox';

export const chatbotAiAgentResponseSchema = Type.Object({
  ai_agent_id: Type.String(),
  name: Type.String(),
});

export type ChatbotAiAgentResponse = Static<
  typeof chatbotAiAgentResponseSchema
>;

export const listChatbotAiAgentsResponseSchema = Type.Array(
  chatbotAiAgentResponseSchema
);

export type ListChatbotAiAgentsResponse = Static<
  typeof listChatbotAiAgentsResponseSchema
>;
