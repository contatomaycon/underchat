import { Static, Type } from '@sinclair/typebox';

export const viewOperatorReplyPendingRedistributionParamsSchema = Type.Object({
  worker_id: Type.String(),
});

export type ViewOperatorReplyPendingRedistributionParams = Static<
  typeof viewOperatorReplyPendingRedistributionParamsSchema
>;
