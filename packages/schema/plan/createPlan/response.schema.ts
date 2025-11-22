import { Static, Type } from '@sinclair/typebox';

export const createPlanResponseSchema = Type.Object({
  plan_id: Type.String({ format: 'uuid' }),
});

export type CreatePlanResponse = Static<typeof createPlanResponseSchema>;
