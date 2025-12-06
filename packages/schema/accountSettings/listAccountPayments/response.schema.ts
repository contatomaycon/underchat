import { pagingResponseSchema } from '@core/schema/common/pagingResponseSchema';
import { Static, Type } from '@sinclair/typebox';

export const listAccountPaymentsResponseSchema = Type.Object({
  account_payment_id: Type.String({ format: 'uuid' }),
  payment_billing_type_id: Type.String({ format: 'uuid' }),
  payment_billing_type_name: Type.String(),
  payment_billing_type_icon: Type.Union([Type.String(), Type.Null()]),
  plan_id: Type.String({ format: 'uuid' }),
  plan_name: Type.String(),
  plan_icon: Type.Union([Type.String(), Type.Null()]),
  value: Type.String(),
  payment_status_id: Type.String({ format: 'uuid' }),
  payment_status_name: Type.String(),
  payment_date: Type.Union([Type.String(), Type.Null()]),
  created_at: Type.String(),
  invoice_url: Type.Union([Type.String(), Type.Null()]),
  cross_sells: Type.Array(
    Type.Object({
      account_payment_cross_sell_id: Type.String({ format: 'uuid' }),
      name: Type.String(),
      quantity: Type.Number(),
      value: Type.String(),
    })
  ),
});

export const listAccountPaymentsFinalResponseSchema = Type.Object({
  ...pagingResponseSchema.properties,
  results: Type.Array(listAccountPaymentsResponseSchema),
});

export type ListAccountPaymentsResponse = Static<
  typeof listAccountPaymentsResponseSchema
>;

export type ListAccountPaymentsFinalResponse = Static<
  typeof listAccountPaymentsFinalResponseSchema
>;
