import { Static, Type } from '@sinclair/typebox';

export const editExpenditureParamsRequestSchema = Type.Object({
  expenditure_id: Type.String({ format: 'uuid' }),
});

export type EditExpenditureParamsRequest = Static<
  typeof editExpenditureParamsRequestSchema
>;

export const updateExpenditureRequestSchema = Type.Object({
  name: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  description: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  price: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
});

export type UpdateExpenditureRequest = Static<
  typeof updateExpenditureRequestSchema
>;
