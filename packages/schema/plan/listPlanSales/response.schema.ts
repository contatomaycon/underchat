import { Static, Type } from '@sinclair/typebox';

const crossSellSchema = Type.Object({
  plan_cross_sell_id: Type.String({ format: 'uuid' }),
  plan_product_name: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  total_price: Type.String(),
  quantity: Type.Number(),
  cross_sell_quantity: Type.Number(),
});

export const listPlanSalesResponseSchema = Type.Object({
  account_payment_id: Type.String({ format: 'uuid' }),
  plan_id: Type.String({ format: 'uuid' }),
  plan_name: Type.String(),
  price: Type.String(),
  price_old: Type.String(),
  total_revenue: Type.String(),
  account_id: Type.String({ format: 'uuid' }),
  account_name: Type.String(),
  cross_sells: Type.Array(crossSellSchema),
  created_at: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  payment_billing_type_name: Type.Optional(
    Type.Union([Type.String(), Type.Null()])
  ),
});

export const listPlanSalesFinalResponseSchema = Type.Object({
  results: Type.Array(listPlanSalesResponseSchema),
});

export type ListPlanSalesResponse = Static<typeof listPlanSalesResponseSchema>;
export type ListPlanSalesFinalResponse = Static<
  typeof listPlanSalesFinalResponseSchema
>;
