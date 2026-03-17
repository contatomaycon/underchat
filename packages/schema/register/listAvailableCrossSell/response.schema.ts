import { Static, Type } from '@sinclair/typebox';

export const listRegisterAvailableCrossSellResponseSchema = Type.Object({
  plan_cross_sell_id: Type.String({ format: 'uuid' }),
  plan_product_id: Type.String({ format: 'uuid' }),
  quantity: Type.Number(),
  price: Type.Number(),
  price_per_cycle: Type.Optional(Type.Number()),
  price_proportional: Type.Optional(Type.Number()),
  billing_period: Type.Optional(
    Type.Union([Type.Literal('monthly'), Type.Literal('annual'), Type.Null()])
  ),
  days_remaining: Type.Optional(Type.Number()),
  total_days: Type.Optional(Type.Number()),
  active_quantity: Type.Optional(Type.Number()),
  renewable_quantity: Type.Optional(Type.Number()),
  active_instances: Type.Optional(Type.Number()),
  renewable_instances: Type.Optional(Type.Number()),
  is_single_use: Type.Optional(Type.Boolean()),
  can_purchase: Type.Optional(Type.Boolean()),
  created_at: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  plan_product: Type.Optional(
    Type.Object({
      plan_product_id: Type.String({ format: 'uuid' }),
      name: Type.Optional(Type.Union([Type.String(), Type.Null()])),
      description: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    })
  ),
});

export const listRegisterAvailableCrossSellFinalResponseSchema = Type.Array(
  listRegisterAvailableCrossSellResponseSchema
);

export type ListRegisterAvailableCrossSellResponse = Static<
  typeof listRegisterAvailableCrossSellResponseSchema
>;
export type ListRegisterAvailableCrossSellFinalResponse = Static<
  typeof listRegisterAvailableCrossSellFinalResponseSchema
>;
