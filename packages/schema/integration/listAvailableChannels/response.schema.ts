import { Static, Type } from '@sinclair/typebox';

export const listAvailableChannelItemSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  number: Type.Union([Type.String(), Type.Null()]),
});

export const listAvailableChannelsResponseSchema = Type.Array(
  listAvailableChannelItemSchema
);

export type ListAvailableChannelItem = Static<
  typeof listAvailableChannelItemSchema
>;
export type ListAvailableChannelsResponse = Static<
  typeof listAvailableChannelsResponseSchema
>;
