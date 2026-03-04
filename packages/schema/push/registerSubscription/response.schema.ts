import { Type, Static } from '@sinclair/typebox';

export const registerPushSubscriptionResponseSchema = Type.Object({
  push_subscription_id: Type.String({
    description: 'ID da subscription criada',
  }),
  public_key: Type.Optional(
    Type.Union([Type.String(), Type.Null()], {
      description: 'Chave pública VAPID (somente webpush)',
    })
  ),
});

export type RegisterPushSubscriptionResponse = Static<
  typeof registerPushSubscriptionResponseSchema
>;
