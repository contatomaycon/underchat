import { Static, Type } from '@sinclair/typebox';
import { userAttendanceHoursRuleSchema } from '@core/schema/user/attendanceHours/shared.schema';

export const viewAttendanceHoursResponseSchema = Type.Object({
  user_id: Type.String(),
  timezone: Type.String(),
  enabled: Type.Boolean(),
  rules: Type.Array(userAttendanceHoursRuleSchema),
});

export type ViewAttendanceHoursResponse = Static<
  typeof viewAttendanceHoursResponseSchema
>;
