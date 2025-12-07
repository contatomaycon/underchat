import { Static, Type } from '@sinclair/typebox';

export const updatePlanRecurringRequestSchema = Type.Object({
  recurring_payment: Type.Boolean(),
});

export type UpdatePlanRecurringRequest = Static<
  typeof updatePlanRecurringRequestSchema
>;
