import { Static, Type } from '@sinclair/typebox';

export const listPlanItemsRequestSchema = Type.Object({
  plan_id: Type.String({ format: 'uuid' }),
});

export type ListPlanItemsRequest = Static<typeof listPlanItemsRequestSchema>;
