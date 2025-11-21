import { Static, Type } from '@sinclair/typebox';

export const deletePlanItemRequestSchema = Type.Object({
  plan_item_id: Type.String({ format: 'uuid' }),
});

export type DeletePlanItemRequest = Static<typeof deletePlanItemRequestSchema>;
