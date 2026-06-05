import { Static, Type } from '@sinclair/typebox';

export const recreateWarmChannelsAllResponseSchema = Type.Object({
  enqueued: Type.Number(),
});

export type RecreateWarmChannelsAllResponse = Static<
  typeof recreateWarmChannelsAllResponseSchema
>;
