import { Static, Type } from '@sinclair/typebox';

export const deletePlanAccountExclusiveRequestSchema = Type.Object({
  plan_account_exclusive_id: Type.String({ format: 'uuid' }),
});

export type DeletePlanAccountExclusiveRequest = Static<
  typeof deletePlanAccountExclusiveRequestSchema
>;
