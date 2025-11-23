import { pagingRequestSchema } from '@core/schema/common/pagingRequestSchema';
import { sortRequestSchema } from '@core/schema/common/sortRequestSchema';
import { Static, Type } from '@sinclair/typebox';

export const listExpenditureRequestSchema = Type.Object({
  ...pagingRequestSchema.properties,
  sort_by: Type.Optional(Type.Array(sortRequestSchema)),
  expenditure_id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  name: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  description: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  price: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export type ListExpenditureRequest = Static<
  typeof listExpenditureRequestSchema
>;
