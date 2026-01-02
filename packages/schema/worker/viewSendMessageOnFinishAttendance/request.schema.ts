import { Static, Type } from '@sinclair/typebox';

export const viewSendMessageOnFinishAttendanceParamsSchema = Type.Object({
  worker_id: Type.String(),
});

export type ViewSendMessageOnFinishAttendanceParams = Static<
  typeof viewSendMessageOnFinishAttendanceParamsSchema
>;
