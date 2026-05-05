import { Static, Type } from '@sinclair/typebox';

export const updateChatAttendanceInactivityParamsSchema = Type.Object({
  chat_id: Type.String({ format: 'uuid' }),
});

export const updateChatAttendanceInactivityBodySchema = Type.Object({
  disabled: Type.Boolean(),
});

export type UpdateChatAttendanceInactivityParams = Static<
  typeof updateChatAttendanceInactivityParamsSchema
>;
export type UpdateChatAttendanceInactivityRequest = Static<
  typeof updateChatAttendanceInactivityBodySchema
>;
