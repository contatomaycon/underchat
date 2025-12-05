import { Static, Type } from '@sinclair/typebox';

export const listAvailableCrossSellResponseSchema = Type.Object({
  plan_cross_sell_id: Type.String({ format: 'uuid' }),
  plan_product_id: Type.String({ format: 'uuid' }),
  quantity: Type.Number(),
  price: Type.Number(),
  created_at: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  plan_product: Type.Optional(
    Type.Object({
      plan_product_id: Type.String({ format: 'uuid' }),
      name: Type.Optional(Type.Union([Type.String(), Type.Null()])),
      description: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    })
  ),
});

export const listAvailableCrossSellFinalResponseSchema = Type.Array(
  listAvailableCrossSellResponseSchema
);

export type ListAvailableCrossSellResponse = Static<
  typeof listAvailableCrossSellResponseSchema
>;
export type ListAvailableCrossSellFinalResponse = Static<
  typeof listAvailableCrossSellFinalResponseSchema
>;
