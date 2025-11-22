import { Static, Type } from '@sinclair/typebox';

export const createPlanRequestSchema = Type.Object({
  name: Type.String(),
  price: Type.Number(),
  price_old: Type.Number(),
});

export type CreatePlanRequest = Static<typeof createPlanRequestSchema>;
