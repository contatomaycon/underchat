import { Static, Type } from '@sinclair/typebox';

export const registerCentrifugoTokenResponseSchema = Type.Object({
  token: Type.String({ description: 'Token de autenticação do Centrifugo' }),
  url: Type.String({ description: 'URL do WebSocket do Centrifugo' }),
});

export type RegisterCentrifugoTokenResponse = Static<
  typeof registerCentrifugoTokenResponseSchema
>;
