import { Static, Type } from '@sinclair/typebox';

export const updateMethodPaymentRequestSchema = Type.Object({
  method_payment_id: Type.String({ format: 'uuid' }),
  status: Type.Boolean(),
});

export type UpdateMethodPaymentRequest = Static<
  typeof updateMethodPaymentRequestSchema
>;
