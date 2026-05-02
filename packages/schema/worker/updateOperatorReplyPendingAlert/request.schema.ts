import { Static, Type } from '@sinclair/typebox';

export const updateOperatorReplyPendingAlertParamsSchema = Type.Object({
  worker_id: Type.String(),
});

export const updateOperatorReplyPendingAlertRequestSchema = Type.Object({
  enabled: Type.Boolean(),
  time_minutes: Type.Integer({ minimum: 1 }),
});

export type UpdateOperatorReplyPendingAlertParams = Static<
  typeof updateOperatorReplyPendingAlertParamsSchema
>;
export type UpdateOperatorReplyPendingAlertRequest = Static<
  typeof updateOperatorReplyPendingAlertRequestSchema
>;
