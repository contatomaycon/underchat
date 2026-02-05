import { Static, Type } from '@sinclair/typebox';

export const listUserChannelsResponseItemSchema = Type.Object({
  channel_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  number: Type.Union([Type.String(), Type.Null()]),
});

export const listUserChannelsResponseSchema = Type.Array(
  listUserChannelsResponseItemSchema
);

export type ListUserChannelsResponseItem = Static<
  typeof listUserChannelsResponseItemSchema
>;
export type ListUserChannelsResponse = Static<
  typeof listUserChannelsResponseSchema
>;
