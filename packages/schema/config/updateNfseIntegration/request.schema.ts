import { Static, Type } from '@sinclair/typebox';

export const updateNfseIntegrationRequestSchema = Type.Object({
  integration_enabled: Type.Boolean(),
  integration_base_url: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  integration_uf: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  integration_tenant: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  integration_username: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  integration_municipality_code: Type.Optional(
    Type.Union([Type.String(), Type.Null()])
  ),
  integration_rps_series: Type.Optional(
    Type.Union([Type.String(), Type.Null()])
  ),
  integration_prestador_document: Type.Optional(
    Type.Union([Type.String(), Type.Null()])
  ),
  integration_prestador_municipal_inscription: Type.Optional(
    Type.Union([Type.String(), Type.Null()])
  ),
  integration_password: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export type UpdateNfseIntegrationRequest = Static<
  typeof updateNfseIntegrationRequestSchema
>;
