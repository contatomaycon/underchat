import { Static, Type } from '@sinclair/typebox';

export const updateChatAttendanceInactivityResponseSchema = Type.Object({
  success: Type.Boolean(),
});

export type UpdateChatAttendanceInactivityResponse = Static<
  typeof updateChatAttendanceInactivityResponseSchema
>;
