import { Static, Type } from '@sinclair/typebox';

export const viewOperatorReplyPendingAlertResponseSchema = Type.Object({
  enabled: Type.Boolean(),
  time_minutes: Type.Integer({ minimum: 1 }),
});

export type ViewOperatorReplyPendingAlertResponse = Static<
  typeof viewOperatorReplyPendingAlertResponseSchema
>;
