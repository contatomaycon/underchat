import { Static, Type } from '@sinclair/typebox';

export const viewCurrentPlanResponseSchema = Type.Object({
  plan_id: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
});

export type ViewCurrentPlanResponse = Static<
  typeof viewCurrentPlanResponseSchema
>;
