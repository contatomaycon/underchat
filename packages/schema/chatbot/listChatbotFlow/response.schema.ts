import { Static, Type } from '@sinclair/typebox';
import {
  chatbotFlowEdgeSchema,
  chatbotFlowNodeSchema,
} from '@core/schema/chatbot/chatbotFlow.schema';

export const listChatbotFlowResponseSchema = Type.Object({
  chatbot_flow_id: Type.String(),
  chatbot_id: Type.String(),
  account_id: Type.String(),
  read_only: Type.Optional(Type.Boolean()),
  restricted: Type.Optional(Type.Boolean()),
  nodes: Type.Array(chatbotFlowNodeSchema),
  edges: Type.Array(chatbotFlowEdgeSchema),
  created_at: Type.Optional(Type.String()),
  updated_at: Type.Optional(Type.String()),
});

export type ListChatbotFlowResponse = Static<
  typeof listChatbotFlowResponseSchema
>;
