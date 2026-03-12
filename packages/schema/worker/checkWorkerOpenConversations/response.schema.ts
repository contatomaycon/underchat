import { Static, Type } from '@sinclair/typebox';

export const checkWorkerOpenConversationsResponseSchema = Type.Object({
  count: Type.Number({
    description: 'Numero de conversas abertas do canal',
  }),
});

export type CheckWorkerOpenConversationsResponse = Static<
  typeof checkWorkerOpenConversationsResponseSchema
>;
