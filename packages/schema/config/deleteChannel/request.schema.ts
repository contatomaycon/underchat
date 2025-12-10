import { Static, Type } from '@sinclair/typebox';

export const deleteChannelRequestSchema = Type.Object({
  channel_id: Type.String({ format: 'uuid' }),
});

export type DeleteChannelRequest = Static<typeof deleteChannelRequestSchema>;
