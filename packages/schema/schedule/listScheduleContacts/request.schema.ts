import { pagingRequestSchema } from '@core/schema/common/pagingRequestSchema';
import { sortRequestSchema } from '@core/schema/common/sortRequestSchema';
import { Static, Type } from '@sinclair/typebox';

export const listScheduleContactsRequestSchema = Type.Object({
  ...pagingRequestSchema.properties,
  sort_by: Type.Optional(Type.Array(sortRequestSchema)),
  search: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export type ListScheduleContactsRequest = Static<
  typeof listScheduleContactsRequestSchema
>;
