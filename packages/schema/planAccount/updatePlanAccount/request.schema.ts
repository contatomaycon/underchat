import { Static, Type } from '@sinclair/typebox';

export const updatePlanAccountParamsRequestSchema = Type.Object({
  account_id: Type.String({ format: 'uuid' }),
});

export type UpdatePlanAccountParamsRequest = Static<
  typeof updatePlanAccountParamsRequestSchema
>;

export const updatePlanAccountRequestSchema = Type.Object({
  plan_id: Type.String({ format: 'uuid' }),
  recurring_payment: Type.Optional(Type.Boolean()),
  billing_period_id: Type.Optional(Type.String({ format: 'uuid' })),
  last_payment_date: Type.Union([
    Type.String({ format: 'date-time' }),
    Type.Null(),
  ]),
  next_payment_date: Type.Union([
    Type.String({ format: 'date-time' }),
    Type.Null(),
  ]),
  cancellation_date: Type.Union([
    Type.String({ format: 'date-time' }),
    Type.Null(),
  ]),
  value: Type.Optional(Type.String()),
});

export type UpdatePlanAccountRequest = Static<
  typeof updatePlanAccountRequestSchema
>;
