import { Static, Type } from '@sinclair/typebox';

export const viewAttendanceInactivityAlertParamsSchema = Type.Object({
  worker_id: Type.String(),
});

export type ViewAttendanceInactivityAlertParams = Static<
  typeof viewAttendanceInactivityAlertParamsSchema
>;
