import { Static, Type } from '@sinclair/typebox';
import {
  chatbotFlowDataSchema,
  type ChatbotFlowData,
} from '@core/schema/chatbot/chatbotFlow.schema';

export const saveChatbotFlowRequestSchema = Type.Object({
  request: Type.Union([
    chatbotFlowDataSchema,
    Type.String(),
    Type.Object({ value: Type.String() }),
  ]),
});

export type SaveChatbotFlowRequest = Static<
  typeof saveChatbotFlowRequestSchema
>;

export type SaveChatbotFlowRequestData = ChatbotFlowData;
