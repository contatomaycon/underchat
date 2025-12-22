import { Static, Type } from '@sinclair/typebox';

export const createPlanAccountExclusiveResponseSchema = Type.Object({
  plan_account_exclusive_id: Type.String({ format: 'uuid' }),
});

export type CreatePlanAccountExclusiveResponse = Static<
  typeof createPlanAccountExclusiveResponseSchema
>;
