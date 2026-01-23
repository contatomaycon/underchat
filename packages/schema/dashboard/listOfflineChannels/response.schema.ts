import { Static, Type } from '@sinclair/typebox';

const workerStatusSchema = Type.Object({
  id: Type.String(),
  name: Type.Union([Type.String(), Type.Null()]),
});

export const listOfflineChannelsResponseSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  status: Type.Union([workerStatusSchema, Type.Null()]),
});

export const listOfflineChannelsFinalResponseSchema = Type.Array(
  listOfflineChannelsResponseSchema
);

export type ListOfflineChannelsResponse = Static<
  typeof listOfflineChannelsResponseSchema
>;
export type ListOfflineChannelsFinalResponse = Static<
  typeof listOfflineChannelsFinalResponseSchema
>;
