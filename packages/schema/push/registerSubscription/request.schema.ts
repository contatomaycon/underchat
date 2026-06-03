import { Type, Static } from '@sinclair/typebox';

export const registerPushSubscriptionRequestSchema = Type.Object({
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
        default: 'webpush',
      }
    )
  ),
  platform: Type.Optional(
    Type.Union(
      [Type.Literal('web'), Type.Literal('ios'), Type.Literal('android')],
      {
        description: 'Plataforma do dispositivo',
      }
    )
  ),
  endpoint: Type.String({ description: 'Endpoint da subscription' }),
  keys: Type.Optional(
    Type.Object({
      p256dh: Type.String({ description: 'Chave pública P256DH' }),
      auth: Type.String({ description: 'Chave de autenticação' }),
    })
  ),
  user_agent: Type.Optional(
    Type.String({ description: 'User agent do navegador' })
  ),
});

export type RegisterPushSubscriptionRequest = Static<
  typeof registerPushSubscriptionRequestSchema
>;
