import { Static, Type } from '@sinclair/typebox';

export const deletePlanRequestSchema = Type.Object({
  plan_id: Type.String({ format: 'uuid' }),
});

export type DeletePlanRequest = Static<typeof deletePlanRequestSchema>;
