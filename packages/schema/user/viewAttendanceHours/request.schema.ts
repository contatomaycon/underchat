import { Static, Type } from '@sinclair/typebox';

export const viewAttendanceHoursRequestSchema = Type.Object({
  user_id: Type.String(),
});

export type ViewAttendanceHoursRequest = Static<
  typeof viewAttendanceHoursRequestSchema
>;
