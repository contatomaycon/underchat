import { Static, Type } from '@sinclair/typebox';

export const updateAttendanceInactivityAlertParamsSchema = Type.Object({
  worker_id: Type.String(),
});

export const updateAttendanceInactivityAlertRequestSchema = Type.Object({
  enabled: Type.Boolean(),
  quantity: Type.Integer({ minimum: 1 }),
  time: Type.Integer({ minimum: 1 }),
  action: Type.Literal('finish'),
  inactivity_message_enabled: Type.Boolean(),
  inactivity_message: Type.Optional(
    Type.Union([Type.String({ maxLength: 2000 }), Type.Null()])
  ),
});

export type UpdateAttendanceInactivityAlertParams = Static<
  typeof updateAttendanceInactivityAlertParamsSchema
>;
export type UpdateAttendanceInactivityAlertRequest = Static<
  typeof updateAttendanceInactivityAlertRequestSchema
>;
