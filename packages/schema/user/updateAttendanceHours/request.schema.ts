import { Static, Type } from '@sinclair/typebox';
import { userAttendanceHoursRuleSchema } from '@core/schema/user/attendanceHours/shared.schema';

export const updateAttendanceHoursRequestParamsSchema = Type.Object({
  user_id: Type.String(),
});

export const updateAttendanceHoursRequestSchema = Type.Object({
  rules: Type.Array(userAttendanceHoursRuleSchema),
});

export type UpdateAttendanceHoursRequestParams = Static<
  typeof updateAttendanceHoursRequestParamsSchema
>;
export type UpdateAttendanceHoursRequest = Static<
  typeof updateAttendanceHoursRequestSchema
>;
