import { Static, Type } from '@sinclair/typebox';

export const viewAttendanceHoursParamsSchema = Type.Object({
  worker_id: Type.String(),
});

export type ViewAttendanceHoursParams = Static<
  typeof viewAttendanceHoursParamsSchema
>;
