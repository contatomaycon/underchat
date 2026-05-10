import { Static, Type } from '@sinclair/typebox';

const workerStatusSchema = Type.Object({
  id: Type.String(),
});

export const chatbotChannelResponseSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  number: Type.Union([Type.String(), Type.Null()]),
  status: Type.Union([workerStatusSchema, Type.Null()]),
});

export type ChatbotChannelResponse = Static<typeof chatbotChannelResponseSchema>;

export const listChatbotChannelsResponseSchema = Type.Array(
  chatbotChannelResponseSchema
);

export type ListChatbotChannelsResponse = Static<
  typeof listChatbotChannelsResponseSchema
>;
