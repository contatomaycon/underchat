import { Static, Type } from '@sinclair/typebox';

const planItemSchema = Type.Object({
  plan_item_id: Type.String({ format: 'uuid' }),
  plan_product: Type.Object({
    plan_product_id: Type.String({ format: 'uuid' }),
    name: Type.Union([Type.String(), Type.Null()]),
  }),
  quantity: Type.Number(),
});

const crossSellSchema = Type.Object({
  plan_cross_sell_id: Type.String({ format: 'uuid' }),
  plan_product: Type.Object({
    plan_product_id: Type.String({ format: 'uuid' }),
    name: Type.Union([Type.String(), Type.Null()]),
  }),
  quantity: Type.Number(),
  price: Type.String(),
});

export const listAccountSubscriptionsResponseSchema = Type.Object({
  plan: Type.Optional(
    Type.Union([
      Type.Object({
        plan_id: Type.String({ format: 'uuid' }),
        name: Type.String(),
        price: Type.String(),
      }),
      Type.Null(),
    ])
  ),
  plan_items: Type.Optional(Type.Array(planItemSchema)),
  cross_sells: Type.Optional(Type.Array(crossSellSchema)),
});

export type ListAccountSubscriptionsResponse = Static<
  typeof listAccountSubscriptionsResponseSchema
>;
