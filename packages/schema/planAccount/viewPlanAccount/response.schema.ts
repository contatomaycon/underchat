import { Static, Type } from '@sinclair/typebox';

export const viewPlanAccountResponseSchema = Type.Object({
  plan_account_id: Type.String({ format: 'uuid' }),
  plan_id: Type.String({ format: 'uuid' }),
  recurring_payment: Type.Boolean(),
  billing_period_id: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
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
  value: Type.String(),
});

export type ViewPlanAccountResponse = Static<
  typeof viewPlanAccountResponseSchema
>;
