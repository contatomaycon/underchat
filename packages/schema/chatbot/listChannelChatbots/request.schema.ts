import { Static, Type } from '@sinclair/typebox';

export const listChannelChatbotsParamsSchema = Type.Object({
  worker_id: Type.String({ format: 'uuid' }),
});

export type ListChannelChatbotsParams = Static<
  typeof listChannelChatbotsParamsSchema
>;
