import { Static, Type } from '@sinclair/typebox';
import { EPlanStatus } from '@core/common/enums/EPlanStatus';

export const createPlanRequestSchema = Type.Object({
  name: Type.String(),
  price: Type.Number(),
  price_old: Type.Number(),
  description: Type.Optional(Type.String({ maxLength: 500 })),
  annual_discount: Type.Optional(Type.Number({ minimum: 0, maximum: 100 })),
  icon: Type.Optional(Type.String({ maxLength: 100 })),
  is_test: Type.Optional(Type.Boolean()),
  days_trial: Type.Optional(
    Type.Union([Type.Number({ minimum: 1 }), Type.Null()])
  ),
  is_exclusive: Type.Optional(Type.Boolean()),
  status: Type.Optional(Type.Enum(EPlanStatus)),
});

export type CreatePlanRequest = Static<typeof createPlanRequestSchema>;
