import { ESortOrder } from '@core/common/enums/ESortOrder';
import { Static, Type } from '@fastify/type-provider-typebox';

export const sortRequestSchema = Type.Object({
  key: Type.String(),
  order: Type.Optional(
    Type.Union([
      Type.Literal(ESortOrder.asc),
      Type.Literal(ESortOrder.desc),
      Type.Boolean(),
    ])
  ),
});

export type SortRequest = Static<typeof sortRequestSchema>;
