import { Static, Type } from '@sinclair/typebox';

export const updatePlanParamsRequestSchema = Type.Object({
  plan_id: Type.String({ format: 'uuid' }),
});

export type UpdatePlanParamsRequest = Static<
  typeof updatePlanParamsRequestSchema
>;

export const updatePlanRequestSchema = Type.Object({
  name: Type.Union([Type.String(), Type.Null()]),
  price: Type.Union([Type.Number(), Type.Null()]),
  price_old: Type.Union([Type.Number(), Type.Null()]),
});

export type UpdatePlanRequest = Static<typeof updatePlanRequestSchema>;
