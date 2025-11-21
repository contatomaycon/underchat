import { pagingResponseSchema } from '@core/schema/common/pagingResponseSchema';
import { Static, Type } from '@sinclair/typebox';

export const listCrossSellResponseSchema = Type.Object({
  plan_cross_sell_id: Type.String({ format: 'uuid' }),
  plan_product_id: Type.String({ format: 'uuid' }),
  quantity: Type.Number(),
  price: Type.Number(),
  created_at: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  plan_product: Type.Optional(
    Type.Object({
      plan_product_id: Type.String({ format: 'uuid' }),
      name: Type.String(),
    })
  ),
});

export const listCrossSellFinalResponseSchema = Type.Object({
  ...pagingResponseSchema.properties,
  results: Type.Array(listCrossSellResponseSchema),
});

export type ListCrossSellResponse = Static<typeof listCrossSellResponseSchema>;
export type ListCrossSellFinalResponse = Static<
  typeof listCrossSellFinalResponseSchema
>;
