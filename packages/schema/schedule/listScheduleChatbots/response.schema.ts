import { Static, Type } from '@sinclair/typebox';

export const listScheduleChatbotsResponseSchema = Type.Object({
  chatbot_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  type: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export const listScheduleChatbotsFinalResponseSchema = Type.Array(
  listScheduleChatbotsResponseSchema
);

export type ListScheduleChatbotsResponse = Static<
  typeof listScheduleChatbotsResponseSchema
>;
export type ListScheduleChatbotsFinalResponse = Static<
  typeof listScheduleChatbotsFinalResponseSchema
>;
