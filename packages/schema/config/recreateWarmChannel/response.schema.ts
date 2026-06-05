import { Static, Type } from '@sinclair/typebox';

export const recreateWarmChannelResponseSchema = Type.Object({
  enqueued: Type.Number(),
});

export type RecreateWarmChannelResponse = Static<
  typeof recreateWarmChannelResponseSchema
>;
