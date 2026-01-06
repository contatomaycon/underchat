import { Static, Type } from '@sinclair/typebox';
import {
  userResponseSchema,
  accountInfoResponseSchema,
} from '@core/schema/masterSession/login/response.schema';

export const sessionLoginResponseSchema = Type.Object({
  user: userResponseSchema,
  permissions: Type.Array(Type.String()),
  layout: Type.Union([accountInfoResponseSchema, Type.Null()]),
  token: Type.String(),
  sectors: Type.Array(Type.String()),
  plan_is_active: Type.Boolean(),
});

export type SessionLoginResponse = Static<typeof sessionLoginResponseSchema>;
