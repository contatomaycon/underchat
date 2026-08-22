import { Static, Type } from '@sinclair/typebox';

export const updateOperatorReplyPendingRedistributionResponseSchema =
  Type.Object({
    enabled: Type.Boolean(),
    time_minutes: Type.Integer({ minimum: 1 }),
    sector_ids: Type.Array(Type.String({ format: 'uuid' })),
  });

export type UpdateOperatorReplyPendingRedistributionResponse = Static<
  typeof updateOperatorReplyPendingRedistributionResponseSchema
>;
