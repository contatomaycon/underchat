import { Static, Type } from '@sinclair/typebox';

export const generateAccountPaymentNfseRequestSchema = Type.Object({
  account_id: Type.String({ format: 'uuid' }),
  account_payment_id: Type.String({ format: 'uuid' }),
});

export type GenerateAccountPaymentNfseRequest = Static<
  typeof generateAccountPaymentNfseRequestSchema
>;
