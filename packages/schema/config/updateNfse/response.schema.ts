import { Static, Type } from '@sinclair/typebox';

export const updateNfseResponseSchema = Type.Object({
  nfse_id: Type.String({ format: 'uuid' }),
  external_id: Type.Union([Type.Number(), Type.Null()]),
  name: Type.String(),
  municipal_service_code: Type.Union([Type.String(), Type.Null()]),
  municipal_service_description_field: Type.Union([Type.String(), Type.Null()]),
  retain_iss: Type.Boolean(),
  iss_value: Type.Union([Type.String(), Type.Null()]),
  cofins_value: Type.Union([Type.String(), Type.Null()]),
  csll_value: Type.Union([Type.String(), Type.Null()]),
  inss_value: Type.Union([Type.String(), Type.Null()]),
  ir_value: Type.Union([Type.String(), Type.Null()]),
  pis_value: Type.Union([Type.String(), Type.Null()]),
  deductions: Type.Union([Type.String(), Type.Null()]),
  has_certificate: Type.Boolean(),
  certificate_file_name: Type.Union([Type.String(), Type.Null()]),
  certificate_uploaded_at: Type.Union([Type.String(), Type.Null()]),
  has_certificate_password: Type.Boolean(),
  default_product: Type.Boolean(),
  created_at: Type.String(),
  updated_at: Type.String(),
});

export type UpdateNfseResponse = Static<typeof updateNfseResponseSchema>;
