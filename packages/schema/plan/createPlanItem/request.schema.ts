import { Static, Type } from '@sinclair/typebox';

export const createPlanItemRequestSchema = Type.Object({
  plan_id: Type.String({ format: 'uuid' }),
  plan_product_id: Type.String({ format: 'uuid' }),
  quantity: Type.Number(),
});

export type CreatePlanItemRequest = Static<typeof createPlanItemRequestSchema>;
