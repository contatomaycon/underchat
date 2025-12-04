import { Static, Type } from '@sinclair/typebox';

export const viewCurrentPlanInvoiceResponseSchema = Type.Object({
  plan_id: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
  plan_name: Type.Union([Type.String(), Type.Null()]),
  plan_icon: Type.Union([Type.String(), Type.Null()]),
  plan_price: Type.Union([Type.Number(), Type.Null()]),
  plan_price_old: Type.Union([Type.Number(), Type.Null()]),
  plan_description: Type.Union([Type.String(), Type.Null()]),
  annual_discount: Type.Union([Type.String(), Type.Null()]),
  next_payment_date: Type.Union([Type.String(), Type.Null()]),
  last_payment_date: Type.Union([Type.String(), Type.Null()]),
  recurring_payment: Type.Union([Type.Boolean(), Type.Null()]),
  billing_period: Type.Union([Type.String(), Type.Null()]),
});

export type ViewCurrentPlanInvoiceResponse = Static<
  typeof viewCurrentPlanInvoiceResponseSchema
>;
