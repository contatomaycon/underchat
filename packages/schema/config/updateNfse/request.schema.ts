import { Static, Type } from '@sinclair/typebox';

export const updateNfseRequestSchema = Type.Object({
  name: Type.String(),
  municipal_service_code: Type.Optional(
    Type.Union([Type.String(), Type.Null()])
  ),
  municipal_service_description_field: Type.Optional(
    Type.Union([Type.String(), Type.Null()])
  ),
  retain_iss: Type.Optional(Type.Boolean()),
  iss_value: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  cofins_value: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  csll_value: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  inss_value: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  ir_value: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  pis_value: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  deductions: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export type UpdateNfseRequest = Static<typeof updateNfseRequestSchema>;
