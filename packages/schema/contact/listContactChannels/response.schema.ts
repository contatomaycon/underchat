import { Static, Type } from '@sinclair/typebox';

export const listContactChannelsResponseItemSchema = Type.Object({
  channel_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  number: Type.Union([Type.String(), Type.Null()]),
});

export const listContactChannelsResponseSchema = Type.Array(
  listContactChannelsResponseItemSchema
);

export type ListContactChannelsResponseItem = Static<
  typeof listContactChannelsResponseItemSchema
>;
export type ListContactChannelsResponse = Static<
  typeof listContactChannelsResponseSchema
>;
