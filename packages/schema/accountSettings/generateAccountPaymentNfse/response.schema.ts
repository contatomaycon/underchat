import { Static, Type } from '@sinclair/typebox';

export const generateAccountPaymentNfseResponseSchema = Type.Object({
  success: Type.Boolean(),
  message: Type.String(),
});

export type GenerateAccountPaymentNfseResponse = Static<
  typeof generateAccountPaymentNfseResponseSchema
>;
