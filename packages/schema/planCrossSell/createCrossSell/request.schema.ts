import { Static, Type } from '@sinclair/typebox';

export const createCrossSellRequestSchema = Type.Object({
  plan_product_id: Type.String({ format: 'uuid' }),
  quantity: Type.Number({ minimum: 1 }),
  price: Type.Number({ minimum: 0 }),
});

export type CreateCrossSellRequest = Static<
  typeof createCrossSellRequestSchema
>;
