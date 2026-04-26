import { Static, Type } from '@sinclair/typebox';

export const updateAttendanceInactivityAlertResponseSchema = Type.Object({
  quantity: Type.Integer({ minimum: 1 }),
  time: Type.Integer({ minimum: 1 }),
  action: Type.Literal('finish'),
  inactivity_message_enabled: Type.Boolean(),
  inactivity_message: Type.Union([Type.String(), Type.Null()]),
  enabled: Type.Boolean(),
});

export type UpdateAttendanceInactivityAlertResponse = Static<
  typeof updateAttendanceInactivityAlertResponseSchema
>;
