import { Static, Type } from '@sinclair/typebox';

export const updateMethodPaymentResponseSchema = Type.Object({
  method_payment_id: Type.String({ format: 'uuid' }),
  type: Type.String(),
  status: Type.Boolean(),
  created_at: Type.String(),
  updated_at: Type.String(),
});

export type UpdateMethodPaymentResponse = Static<
  typeof updateMethodPaymentResponseSchema
>;
