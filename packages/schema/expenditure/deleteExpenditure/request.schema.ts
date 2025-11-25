import { Static, Type } from '@sinclair/typebox';

export const deleteExpenditureRequestSchema = Type.Object({
  expenditure_id: Type.String({ format: 'uuid' }),
});

export type DeleteExpenditureRequest = Static<
  typeof deleteExpenditureRequestSchema
>;
