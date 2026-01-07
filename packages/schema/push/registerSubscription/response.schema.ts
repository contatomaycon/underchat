import { Type, Static } from '@sinclair/typebox';

export const registerPushSubscriptionResponseSchema = Type.Object({
  push_subscription_id: Type.String({
    description: 'ID da subscription criada',
  }),
  public_key: Type.String({ description: 'Chave pública VAPID' }),
});

export type RegisterPushSubscriptionResponse = Static<
  typeof registerPushSubscriptionResponseSchema
>;
