import { Type, Static } from '@sinclair/typebox';

export const deletePushSubscriptionRequestSchema = Type.Object({
  endpoint: Type.String({
    description: 'Endpoint da subscription a ser removida',
  }),
  provider: Type.Optional(
    Type.Union(
      [
        Type.Literal('webpush'),
        Type.Literal('expo'),
        Type.Literal('fcm'),
        Type.Literal('apns'),
      ],
      {
        description: 'Provider da subscription',
      }
    )
  ),
});

export type DeletePushSubscriptionRequest = Static<
  typeof deletePushSubscriptionRequestSchema
>;
