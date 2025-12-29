import { Static, Type } from '@sinclair/typebox';

export const createPlanItemRequestSchema = Type.Object({
  plan_id: Type.String({ format: 'uuid' }),
  plan_product_id: Type.String({ format: 'uuid' }),
  quantity: Type.Number({
    minimum: 1,
    maximum: 9999999999,
  }),
});

export type CreatePlanItemRequest = Static<typeof createPlanItemRequestSchema>;
