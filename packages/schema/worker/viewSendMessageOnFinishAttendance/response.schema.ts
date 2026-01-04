import { Static, Type } from '@sinclair/typebox';

export const viewSendMessageOnFinishAttendanceResponseSchema = Type.Object({
  send_message_on_finish_attendance: Type.Union([Type.String(), Type.Null()]),
  enabled: Type.Boolean(),
});

export type ViewSendMessageOnFinishAttendanceResponse = Static<
  typeof viewSendMessageOnFinishAttendanceResponseSchema
>;
