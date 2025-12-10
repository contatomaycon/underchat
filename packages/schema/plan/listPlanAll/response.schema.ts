import { Static, Type } from '@sinclair/typebox';

export const listPlanAllResponseSchema = Type.Object({
  plan_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  is_test: Type.Boolean(),
  days_trial: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
});

export type ListPlanAllResponse = Static<typeof listPlanAllResponseSchema>;
