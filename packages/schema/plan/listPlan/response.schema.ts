import { pagingResponseSchema } from '@core/schema/common/pagingResponseSchema';
import { Static, Type } from '@sinclair/typebox';

export const listPlanResponseSchema = Type.Object({
  plan_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  price: Type.Number(),
  price_old: Type.Number(),
  created_at: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export const listPlanFinalResponseSchema = Type.Object({
  ...pagingResponseSchema.properties,
  results: Type.Array(listPlanResponseSchema),
});

export type ListPlanResponse = Static<typeof listPlanResponseSchema>;
export type ListPlanFinalResponse = Static<typeof listPlanFinalResponseSchema>;
