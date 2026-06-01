import { Static, Type } from '@sinclair/typebox';
import {
  accountInfoResponseSchema,
  authUserResponseSchema,
  userChannelResponseSchema,
} from '@core/schema/auth/login/response.schema';
import { userAttendanceGuardStatusSchema } from '@core/schema/user/attendanceHours/shared.schema';

export const refreshTokenResponseSchema = Type.Object({
  token: Type.String(),
  user: authUserResponseSchema,
  permissions: Type.Array(Type.String()),
  layout: Type.Union([accountInfoResponseSchema, Type.Null()]),
  sectors: Type.Array(Type.String()),
  channels: Type.Array(userChannelResponseSchema),
  plan_is_active: Type.Boolean(),
  attendance_guard: userAttendanceGuardStatusSchema,
});

export type RefreshTokenResponse = Static<typeof refreshTokenResponseSchema>;
