import { Type, Static } from '@sinclair/typebox';

export const deletePushSubscriptionRequestSchema = Type.Object({
  endpoint: Type.String({
    description: 'Endpoint da subscription a ser removida',
  }),
});

export type DeletePushSubscriptionRequest = Static<
  typeof deletePushSubscriptionRequestSchema
>;
