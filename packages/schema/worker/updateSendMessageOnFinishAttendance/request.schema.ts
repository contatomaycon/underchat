import { Static, Type } from '@sinclair/typebox';

export const updateSendMessageOnFinishAttendanceParamsSchema = Type.Object({
  worker_id: Type.String(),
});

export const updateSendMessageOnFinishAttendanceRequestSchema = Type.Object({
  text: Type.Optional(Type.String({ maxLength: 2000 })),
});

export type UpdateSendMessageOnFinishAttendanceParams = Static<
  typeof updateSendMessageOnFinishAttendanceParamsSchema
>;
export type UpdateSendMessageOnFinishAttendanceRequest = Static<
  typeof updateSendMessageOnFinishAttendanceRequestSchema
>;
