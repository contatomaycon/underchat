import { Static, Type } from '@sinclair/typebox';

export const updateCrossSellRequestSchema = Type.Object({
  plan_product_id: Type.Optional(Type.String({ format: 'uuid' })),
  quantity: Type.Optional(Type.Number({ minimum: 1 })),
  price: Type.Optional(Type.Number({ minimum: 0 })),
});

export const updateCrossSellParamsRequestSchema = Type.Object({
  plan_cross_sell_id: Type.String({ format: 'uuid' }),
});

export type UpdateCrossSellRequest = Static<
  typeof updateCrossSellRequestSchema
>;
export type UpdateCrossSellParamsRequest = Static<
  typeof updateCrossSellParamsRequestSchema
>;
