import { Static, Type } from '@sinclair/typebox';

export const viewAccountPaymentNfseResponseSchema = Type.Object({
  account_payment_nfse_id: Type.String({ format: 'uuid' }),
  type: Type.Union([Type.String(), Type.Null()]),
  status_description: Type.Union([Type.String(), Type.Null()]),
  rps_serie: Type.Union([Type.String(), Type.Null()]),
  number: Type.Union([Type.String(), Type.Null()]),
  validation_code: Type.Union([Type.String(), Type.Null()]),
  value: Type.String(),
  pdf_url: Type.Union([Type.String(), Type.Null()]),
  xml_url: Type.Union([Type.String(), Type.Null()]),
  created_at: Type.String(),
  status_name: Type.String(),
});

export type ViewAccountPaymentNfseResponse = Static<
  typeof viewAccountPaymentNfseResponseSchema
>;
