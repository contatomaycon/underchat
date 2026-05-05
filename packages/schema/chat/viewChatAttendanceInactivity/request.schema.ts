import { Static, Type } from '@sinclair/typebox';

export const viewChatAttendanceInactivityParamsSchema = Type.Object({
  chat_id: Type.String({ format: 'uuid' }),
});

export type ViewChatAttendanceInactivityParams = Static<
  typeof viewChatAttendanceInactivityParamsSchema
>;
