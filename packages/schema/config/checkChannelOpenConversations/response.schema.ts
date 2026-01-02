import { Type, Static } from '@sinclair/typebox';

export const checkChannelOpenConversationsResponseSchema = Type.Object({
  count: Type.Number({
    description: 'Número de conversas abertas do canal',
  }),
});

export type CheckChannelOpenConversationsResponse = Static<
  typeof checkChannelOpenConversationsResponseSchema
>;
