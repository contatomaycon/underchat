import { Static, Type } from '@sinclair/typebox';

export const updateOperatorReplyPendingAlertResponseSchema = Type.Object({
  enabled: Type.Boolean(),
  time_minutes: Type.Integer({ minimum: 1 }),
});

export type UpdateOperatorReplyPendingAlertResponse = Static<
  typeof updateOperatorReplyPendingAlertResponseSchema
>;
