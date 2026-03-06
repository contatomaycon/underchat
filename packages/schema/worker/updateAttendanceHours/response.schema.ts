import { Static, Type } from '@sinclair/typebox';

const attendanceRuleSchema = Type.Object({
  weekday: Type.Union([
    Type.Literal('monday'),
    Type.Literal('tuesday'),
    Type.Literal('wednesday'),
    Type.Literal('thursday'),
    Type.Literal('friday'),
    Type.Literal('saturday'),
    Type.Literal('sunday'),
  ]),
  start_time: Type.String({ pattern: '^([01]\\d|2[0-3]):([0-5]\\d)$' }),
  end_time: Type.String({ pattern: '^([01]\\d|2[0-3]):([0-5]\\d)$' }),
});

const attendanceHoursSchema = Type.Object({
  timezone: Type.String(),
  outside_hours_action: Type.Union([
    Type.Literal('continue_flow'),
    Type.Literal('message_only'),
  ]),
  message_only_destination_status: Type.Union([
    Type.Literal('queue'),
    Type.Literal('closed'),
  ]),
  message_only_queue_sector_id: Type.Union([Type.String(), Type.Null()]),
  rules: Type.Array(attendanceRuleSchema),
});

export const updateAttendanceHoursResponseSchema = Type.Object({
  attendance_hours: attendanceHoursSchema,
  outside_hours_message: Type.Union([Type.String(), Type.Null()]),
  enabled: Type.Boolean(),
});

export type UpdateAttendanceHoursResponse = Static<
  typeof updateAttendanceHoursResponseSchema
>;
