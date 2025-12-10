import { Static, Type } from '@sinclair/typebox';

export const viewAccountPaymentNfseRequestSchema = Type.Object({
  account_payment_id: Type.String({ format: 'uuid' }),
});

export type ViewAccountPaymentNfseRequest = Static<
  typeof viewAccountPaymentNfseRequestSchema
>;
