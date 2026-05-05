import { Static, Type } from '@sinclair/typebox';

export const viewChatAttendanceInactivityResponseSchema = Type.Object({
  disabled: Type.Boolean(),
});

export type ViewChatAttendanceInactivityResponse = Static<
  typeof viewChatAttendanceInactivityResponseSchema
>;
