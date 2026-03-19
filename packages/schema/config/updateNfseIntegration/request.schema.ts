import { Static, Type } from '@sinclair/typebox';

export const updateNfseIntegrationRequestSchema = Type.Object({
  integration_enabled: Type.Boolean(),
  integration_base_url: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  integration_uf: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  integration_tenant: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  integration_username: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  integration_password: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export type UpdateNfseIntegrationRequest = Static<
  typeof updateNfseIntegrationRequestSchema
>;
