import { Static, Type } from '@sinclair/typebox';

export const createExpenditureResponseSchema = Type.Object({
  expenditure_id: Type.String({ format: 'uuid' }),
});

export type CreateExpenditureResponse = Static<
  typeof createExpenditureResponseSchema
>;
