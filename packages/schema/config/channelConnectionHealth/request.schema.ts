import { Static, Type } from '@sinclair/typebox';

export const configChannelConnectionHealthRequestSchema = Type.Object({
  channel_id: Type.String({ format: 'uuid' }),
});

export type ConfigChannelConnectionHealthRequest = Static<
  typeof configChannelConnectionHealthRequestSchema
>;
