import { pagingRequestSchema } from '@core/schema/common/pagingRequestSchema';
import { sortRequestSchema } from '@core/schema/common/sortRequestSchema';
import { Static, Type } from '@sinclair/typebox';

export const listSalesReportRequestSchema = Type.Object({
  ...pagingRequestSchema.properties,
  sort_by: Type.Optional(Type.Array(sortRequestSchema)),
  plan_id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  date_from: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  date_to: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  search: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export type ListSalesReportRequest = Static<
  typeof listSalesReportRequestSchema
>;
