import { Static, Type } from '@sinclair/typebox';

const planSchema = Type.Object({
  plan_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  is_exclusive: Type.Boolean(),
});

export const listPlanAccountExclusiveResponseSchema = Type.Object({
  plan_account_exclusive_id: Type.String({ format: 'uuid' }),
  plan_id: Type.String({ format: 'uuid' }),
  account_id: Type.String({ format: 'uuid' }),
  created_at: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  plan: Type.Union([planSchema, Type.Null()]),
});

export const listPlanAccountExclusivesResponseSchema = Type.Array(
  listPlanAccountExclusiveResponseSchema
);

export type ListPlanAccountExclusiveResponse = Static<
  typeof listPlanAccountExclusiveResponseSchema
>;
export type ListPlanAccountExclusivesResponse = Static<
  typeof listPlanAccountExclusivesResponseSchema
>;
