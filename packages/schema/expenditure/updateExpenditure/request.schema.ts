import { Static, Type } from '@sinclair/typebox';

export const updateExpenditureParamsRequestSchema = Type.Object({
  expenditure_id: Type.String({ format: 'uuid' }),
});

export type UpdateExpenditureParamsRequest = Static<
  typeof updateExpenditureParamsRequestSchema
>;

export const updateExpenditureRequestSchema = Type.Object({
  name: Type.Union([Type.String(), Type.Null()]),
  description: Type.Union([Type.String(), Type.Null()]),
  price: Type.Union([Type.Number(), Type.Null()]),
});

export type UpdateExpenditureRequest = Static<
  typeof updateExpenditureRequestSchema
>;
