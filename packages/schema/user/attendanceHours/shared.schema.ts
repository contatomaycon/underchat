import { Static, Type } from '@sinclair/typebox';

export const userAttendanceHoursWeekdaySchema = Type.Union([
  Type.Literal('monday'),
  Type.Literal('tuesday'),
  Type.Literal('wednesday'),
  Type.Literal('thursday'),
  Type.Literal('friday'),
  Type.Literal('saturday'),
  Type.Literal('sunday'),
]);

export const userAttendanceHoursRuleSchema = Type.Object({
  weekday: userAttendanceHoursWeekdaySchema,
  start_time: Type.String({ pattern: '^([01]\\d|2[0-3]):([0-5]\\d)$' }),
  end_time: Type.String({ pattern: '^([01]\\d|2[0-3]):([0-5]\\d)$' }),
});

export const userAttendanceGuardStatusSchema = Type.Object({
  timezone: Type.String(),
  is_restricted_today: Type.Boolean(),
  is_blocked_now: Type.Boolean(),
  today_rules: Type.Array(userAttendanceHoursRuleSchema),
  today_windows_label: Type.Union([Type.String(), Type.Null()]),
  next_transition_at: Type.Union([Type.String(), Type.Null()]),
  next_unlock_at: Type.Union([Type.String(), Type.Null()]),
  next_lock_at: Type.Union([Type.String(), Type.Null()]),
  server_now: Type.String(),
});

export const userAttendanceHoursBlockedDataSchema = Type.Object({
  reason: Type.Literal('user_attendance_hours_blocked'),
  attendance_guard: userAttendanceGuardStatusSchema,
});

export type UserAttendanceHoursRule = Static<
  typeof userAttendanceHoursRuleSchema
>;
export type UserAttendanceGuardStatus = Static<
  typeof userAttendanceGuardStatusSchema
>;
export type UserAttendanceHoursBlockedData = Static<
  typeof userAttendanceHoursBlockedDataSchema
>;
