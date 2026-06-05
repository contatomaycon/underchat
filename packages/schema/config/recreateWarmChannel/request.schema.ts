import { Static, Type } from '@sinclair/typebox';

export const recreateWarmChannelRequestSchema = Type.Object({
  warm_pool_id: Type.String({ format: 'uuid' }),
});

export type RecreateWarmChannelRequest = Static<
  typeof recreateWarmChannelRequestSchema
>;
