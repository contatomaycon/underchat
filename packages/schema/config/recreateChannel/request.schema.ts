import { Static, Type } from '@sinclair/typebox';

export const recreateChannelRequestSchema = Type.Object({
  channel_id: Type.String({ format: 'uuid' }),
});

export type RecreateChannelRequest = Static<
  typeof recreateChannelRequestSchema
>;
