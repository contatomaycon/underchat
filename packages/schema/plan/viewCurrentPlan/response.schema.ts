import { Static, Type } from '@sinclair/typebox';

export const viewCurrentPlanResponseSchema = Type.Object({
  plan_id: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
  billing_period: Type.Optional(
    Type.Union([Type.Literal('monthly'), Type.Literal('annual'), Type.Null()])
  ),
  next_payment_date: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  last_payment_date: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export type ViewCurrentPlanResponse = Static<
  typeof viewCurrentPlanResponseSchema
>;
