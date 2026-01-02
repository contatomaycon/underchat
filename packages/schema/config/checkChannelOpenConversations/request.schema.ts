import { Static, Type } from '@sinclair/typebox';

export const checkChannelOpenConversationsRequestSchema = Type.Object({
  channel_id: Type.String({ format: 'uuid' }),
});

export type CheckChannelOpenConversationsRequest = Static<
  typeof checkChannelOpenConversationsRequestSchema
>;
