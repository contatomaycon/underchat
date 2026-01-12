import { Static, Type } from '@sinclair/typebox';

export const viewAccountPaymentNfseRequestSchema = Type.Object({
  account_id: Type.String({ format: 'uuid' }),
  account_payment_id: Type.String({ format: 'uuid' }),
});

export type ViewAccountPaymentNfseRequest = Static<
  typeof viewAccountPaymentNfseRequestSchema
>;
