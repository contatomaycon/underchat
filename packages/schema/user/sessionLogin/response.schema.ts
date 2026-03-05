import { Static, Type } from '@sinclair/typebox';
import {
  userResponseSchema,
  accountInfoResponseSchema,
} from '@core/schema/masterSession/login/response.schema';
import { userChannelResponseSchema } from '@core/schema/auth/login/response.schema';
import { userAttendanceGuardStatusSchema } from '@core/schema/user/attendanceHours/shared.schema';

export const sessionLoginResponseSchema = Type.Object({
  user: userResponseSchema,
  permissions: Type.Array(Type.String()),
  layout: Type.Union([accountInfoResponseSchema, Type.Null()]),
  token: Type.String(),
  sectors: Type.Array(Type.String()),
  channels: Type.Array(userChannelResponseSchema),
  plan_is_active: Type.Boolean(),
  attendance_guard: userAttendanceGuardStatusSchema,
});

export type SessionLoginResponse = Static<typeof sessionLoginResponseSchema>;
