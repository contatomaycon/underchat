import { Static, Type } from '@sinclair/typebox';

export const listPlanProductAllResponseSchema = Type.Object({
  plan_product_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
});

export type ListPlanProductAllResponse = Static<
  typeof listPlanProductAllResponseSchema
>;
