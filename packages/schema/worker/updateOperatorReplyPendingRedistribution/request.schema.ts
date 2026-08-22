import { Static, Type } from '@sinclair/typebox';

export const updateOperatorReplyPendingRedistributionParamsSchema = Type.Object(
  {
    worker_id: Type.String(),
  }
);

export const updateOperatorReplyPendingRedistributionRequestSchema =
  Type.Object({
    enabled: Type.Boolean(),
    time_minutes: Type.Integer({ minimum: 1 }),
    sector_ids: Type.Optional(Type.Array(Type.String({ format: 'uuid' }))),
  });

export type UpdateOperatorReplyPendingRedistributionParams = Static<
  typeof updateOperatorReplyPendingRedistributionParamsSchema
>;
export type UpdateOperatorReplyPendingRedistributionRequest = Static<
  typeof updateOperatorReplyPendingRedistributionRequestSchema
>;
