import { Static, Type } from '@sinclair/typebox';
import { EPlanStatus } from '@core/common/enums/EPlanStatus';

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
  is_test: Type.Optional(Type.Union([Type.Boolean(), Type.Null()])),
  days_trial: Type.Optional(
    Type.Union([Type.Number({ minimum: 1 }), Type.Null()])
  ),
  is_exclusive: Type.Optional(Type.Union([Type.Boolean(), Type.Null()])),
  status: Type.Optional(Type.Union([Type.Enum(EPlanStatus), Type.Null()])),
});

export type UpdatePlanRequest = Static<typeof updatePlanRequestSchema>;
