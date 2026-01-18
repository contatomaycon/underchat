import { Static, Type } from '@sinclair/typebox';

export const methodPaymentItemSchema = Type.Object({
  method_payment_id: Type.String({ format: 'uuid' }),
  type: Type.String(),
  status: Type.Boolean(),
  created_at: Type.String(),
  updated_at: Type.String(),
});

export const listMethodPaymentsResponseSchema = Type.Array(
  methodPaymentItemSchema
);

export type MethodPaymentItem = Static<typeof methodPaymentItemSchema>;
export type ListMethodPaymentsResponse = Static<
  typeof listMethodPaymentsResponseSchema
>;
