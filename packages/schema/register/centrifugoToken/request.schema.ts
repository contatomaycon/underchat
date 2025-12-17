import { Static, Type } from '@sinclair/typebox';

export const registerCentrifugoTokenRequestSchema = Type.Object({
  account_id: Type.String({
    format: 'uuid',
    description: 'ID da conta criada',
  }),
});

export type RegisterCentrifugoTokenRequest = Static<
  typeof registerCentrifugoTokenRequestSchema
>;
