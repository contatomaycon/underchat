import { Static, Type } from '@sinclair/typebox';

export const listPlanProductAllResponseSchema = Type.Object({
  plan_product_id: Type.String({ format: 'uuid' }),
  name: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  description: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export type ListPlanProductAllResponse = Static<
  typeof listPlanProductAllResponseSchema
>;
