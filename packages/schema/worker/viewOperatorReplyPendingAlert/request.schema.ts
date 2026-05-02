import { Static, Type } from '@sinclair/typebox';

export const viewOperatorReplyPendingAlertParamsSchema = Type.Object({
  worker_id: Type.String(),
});

export type ViewOperatorReplyPendingAlertParams = Static<
  typeof viewOperatorReplyPendingAlertParamsSchema
>;
