import { Static, Type } from '@sinclair/typebox';

export const listPlanSalesRequestSchema = Type.Object({
  plan_id: Type.Optional(
    Type.Union([Type.String({ format: 'uuid' }), Type.Null()])
  ),
  start_date: Type.Optional(
    Type.Union([Type.String({ format: 'date-time' }), Type.Null()])
  ),
  end_date: Type.Optional(
    Type.Union([Type.String({ format: 'date-time' }), Type.Null()])
  ),
  payment_billing_type_id: Type.Optional(
    Type.Union([Type.String({ format: 'uuid' }), Type.Null()])
  ),
});

export type ListPlanSalesRequest = Static<typeof listPlanSalesRequestSchema>;
