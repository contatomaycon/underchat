import { Static, Type } from '@sinclair/typebox';

export const channelChatbotResponseSchema = Type.Object({
  chatbot_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  type: Type.Union([Type.Literal('input'), Type.Literal('output')]),
});

export const listChannelChatbotsResponseSchema = Type.Array(
  channelChatbotResponseSchema
);

export type ChannelChatbotResponse = Static<
  typeof channelChatbotResponseSchema
>;
export type ListChannelChatbotsResponse = Static<
  typeof listChannelChatbotsResponseSchema
>;
