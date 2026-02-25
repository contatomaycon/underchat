import { Static, Type } from '@sinclair/typebox';

export const chatbotRandomMessageResponseSchema = Type.Object({
  random_message_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
});

export type ChatbotRandomMessageResponse = Static<
  typeof chatbotRandomMessageResponseSchema
>;

export const listChatbotRandomMessagesResponseSchema = Type.Array(
  chatbotRandomMessageResponseSchema
);

export type ListChatbotRandomMessagesResponse = Static<
  typeof listChatbotRandomMessagesResponseSchema
>;
