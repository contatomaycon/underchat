import { Static, Type } from '@sinclair/typebox';

export const listPlanAccountExclusiveRequestSchema = Type.Object({
  account_id: Type.String({ format: 'uuid' }),
});

export type ListPlanAccountExclusiveRequest = Static<
  typeof listPlanAccountExclusiveRequestSchema
>;
