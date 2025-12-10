import { Static, Type } from '@sinclair/typebox';

export const listPlanProductWithPriceResponseSchema = Type.Object({
  plan_product_id: Type.String({ format: 'uuid' }),
  name: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  description: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  price: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
});

export type ListPlanProductWithPriceResponse = Static<
  typeof listPlanProductWithPriceResponseSchema
>;

export const listPlanProductWithPriceFinalResponseSchema = Type.Array(
  listPlanProductWithPriceResponseSchema
);

export type ListPlanProductWithPriceFinalResponse = Static<
  typeof listPlanProductWithPriceFinalResponseSchema
>;
