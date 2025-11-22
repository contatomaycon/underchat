import { Static, Type } from '@sinclair/typebox';

export const updatePlanResponseSchema = Type.Object({
  plan_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  price: Type.Number(),
  price_old: Type.Number(),
});

export type UpdatePlanResponse = Static<typeof updatePlanResponseSchema>;
