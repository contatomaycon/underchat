import { Type, Static } from '@sinclair/typebox';

export const registerPushSubscriptionRequestSchema = Type.Object({
  endpoint: Type.String({ description: 'Endpoint da subscription' }),
  keys: Type.Object({
    p256dh: Type.String({ description: 'Chave pública P256DH' }),
    auth: Type.String({ description: 'Chave de autenticação' }),
  }),
  user_agent: Type.Optional(
    Type.String({ description: 'User agent do navegador' })
  ),
});

export type RegisterPushSubscriptionRequest = Static<
  typeof registerPushSubscriptionRequestSchema
>;
