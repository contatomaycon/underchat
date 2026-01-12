import { Static, Type } from '@sinclair/typebox';

export const generateAccountPaymentNfseRequestSchema = Type.Object({
  account_payment_id: Type.String({ format: 'uuid' }),
});

export type GenerateAccountPaymentNfseRequest = Static<
  typeof generateAccountPaymentNfseRequestSchema
>;
