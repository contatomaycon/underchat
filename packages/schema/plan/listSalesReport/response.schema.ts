import { Static, Type } from '@sinclair/typebox';
import { pagingResponseSchema } from '@core/schema/common/pagingResponseSchema';

export const salesReportItemSchema = Type.Object({
  plan_id: Type.String(),
  name: Type.String(),
  price: Type.String(),
  price_old: Type.String(),
  sold_count: Type.Number(),
  total_revenue: Type.String(),
  created_at: Type.String(),
});

export const listSalesReportResponseSchema = Type.Object({
  ...pagingResponseSchema.properties,
  results: Type.Array(salesReportItemSchema),
});

export type SalesReportItem = Static<typeof salesReportItemSchema>;
export type ListSalesReportResponse = Static<
  typeof listSalesReportResponseSchema
>;
