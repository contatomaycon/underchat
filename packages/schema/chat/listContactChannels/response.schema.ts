import { Static, Type } from '@sinclair/typebox';

export const listChatContactChannelsResponseItemSchema = Type.Object({
  channel_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  number: Type.Union([Type.String(), Type.Null()]),
});

export const listChatContactChannelsResponseSchema = Type.Array(
  listChatContactChannelsResponseItemSchema
);

export type ListChatContactChannelsResponseItem = Static<
  typeof listChatContactChannelsResponseItemSchema
>;
export type ListChatContactChannelsResponse = Static<
  typeof listChatContactChannelsResponseSchema
>;
