import { Static, Type } from '@sinclair/typebox';

export const updateSendMessageOnFinishAttendanceResponseSchema = Type.Object({
  send_message_on_finish_attendance: Type.Union([Type.String(), Type.Null()]),
});

export type UpdateSendMessageOnFinishAttendanceResponse = Static<
  typeof updateSendMessageOnFinishAttendanceResponseSchema
>;
