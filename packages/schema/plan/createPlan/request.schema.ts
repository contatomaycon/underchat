import { Static, Type } from '@sinclair/typebox';

export const createPlanRequestSchema = Type.Object({
  name: Type.String(),
  price: Type.Number(),
  price_old: Type.Number(),
  description: Type.Optional(Type.String({ maxLength: 500 })),
  annual_discount: Type.Optional(Type.Number({ minimum: 0, maximum: 100 })),
  icon: Type.Optional(Type.String({ maxLength: 100 })),
});

export type CreatePlanRequest = Static<typeof createPlanRequestSchema>;
