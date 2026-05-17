import { Static, Type } from '@sinclair/typebox';

export const listPlanSalesSummaryResponseSchema = Type.Object({
  total_clients: Type.Number(),
  new_clients: Type.Number(),
});

export type ListPlanSalesSummaryResponse = Static<
  typeof listPlanSalesSummaryResponseSchema
>;
