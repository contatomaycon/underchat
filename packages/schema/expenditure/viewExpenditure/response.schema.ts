import { Static, Type } from '@sinclair/typebox';

export const viewExpenditureResponseSchema = Type.Object({
  expenditure_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  description: Type.Union([Type.String(), Type.Null()]),
  price: Type.Number(),
  created_at: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  updated_at: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export type ViewExpenditureResponse = Static<
  typeof viewExpenditureResponseSchema
>;
