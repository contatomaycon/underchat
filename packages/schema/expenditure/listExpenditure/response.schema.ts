import { pagingResponseSchema } from '@core/schema/common/pagingResponseSchema';
import { Static, Type } from '@sinclair/typebox';

export const listExpenditureResponseSchema = Type.Object({
  expenditure_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  description: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  price: Type.Number(),
  created_at: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  updated_at: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export const listExpenditureFinalResponseSchema = Type.Object({
  ...pagingResponseSchema.properties,
  results: Type.Array(listExpenditureResponseSchema),
});

export type ListExpenditureResponse = Static<
  typeof listExpenditureResponseSchema
>;
export type ListExpenditureFinalResponse = Static<
  typeof listExpenditureFinalResponseSchema
>;
