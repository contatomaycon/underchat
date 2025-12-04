import { Static, Type } from '@sinclair/typebox';

export const updatePlanParamsRequestSchema = Type.Object({
  plan_id: Type.String({ format: 'uuid' }),
});

export type UpdatePlanParamsRequest = Static<
  typeof updatePlanParamsRequestSchema
>;

export const updatePlanRequestSchema = Type.Object({
  name: Type.Union([Type.String(), Type.Null()]),
  price: Type.Union([Type.Number(), Type.Null()]),
  price_old: Type.Union([Type.Number(), Type.Null()]),
  description: Type.Optional(
    Type.Union([Type.String({ maxLength: 500 }), Type.Null()])
  ),
  annual_discount: Type.Optional(
    Type.Union([Type.Number({ minimum: 0, maximum: 100 }), Type.Null()])
  ),
  icon: Type.Optional(
    Type.Union([Type.String({ maxLength: 100 }), Type.Null()])
  ),
});

export type UpdatePlanRequest = Static<typeof updatePlanRequestSchema>;
