import { Static, Type } from '@sinclair/typebox';

export const viewExpenditureRequestSchema = Type.Object({
  expenditure_id: Type.String({ format: 'uuid' }),
});

export type ViewExpenditureRequest = Static<
  typeof viewExpenditureRequestSchema
>;
