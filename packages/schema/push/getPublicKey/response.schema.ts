import { Type, Static } from '@sinclair/typebox';

export const getPushPublicKeyResponseSchema = Type.Object({
  public_key: Type.String({ description: 'Chave pública VAPID' }),
});

export type GetPushPublicKeyResponse = Static<
  typeof getPushPublicKeyResponseSchema
>;
