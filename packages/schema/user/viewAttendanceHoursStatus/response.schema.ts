import { Static } from '@sinclair/typebox';
import { userAttendanceGuardStatusSchema } from '@core/schema/user/attendanceHours/shared.schema';

export const viewAttendanceHoursStatusResponseSchema =
  userAttendanceGuardStatusSchema;

export type ViewAttendanceHoursStatusResponse = Static<
  typeof viewAttendanceHoursStatusResponseSchema
>;
