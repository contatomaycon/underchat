import { Static, Type } from '@sinclair/typebox';

export const createPlanAccountExclusiveRequestSchema = Type.Object({
  plan_id: Type.String({ format: 'uuid' }),
  account_id: Type.String({ format: 'uuid' }),
});

export type CreatePlanAccountExclusiveRequest = Static<
  typeof createPlanAccountExclusiveRequestSchema
>;
