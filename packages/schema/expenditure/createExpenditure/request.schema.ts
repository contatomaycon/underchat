import { Static, Type } from '@sinclair/typebox';

export const createExpenditureRequestSchema = Type.Object({
  name: Type.String(),
  description: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  price: Type.Number(),
});

export type CreateExpenditureRequest = Static<
  typeof createExpenditureRequestSchema
>;
