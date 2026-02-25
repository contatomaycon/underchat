import { Static, Type } from '@sinclair/typebox';

const attendanceDaySchema = Type.Object({
  enabled: Type.Boolean(),
  start_time: Type.Union([Type.String(), Type.Null()]),
  end_time: Type.Union([Type.String(), Type.Null()]),
});

const attendanceDaysSchema = Type.Object({
  monday: attendanceDaySchema,
  tuesday: attendanceDaySchema,
  wednesday: attendanceDaySchema,
  thursday: attendanceDaySchema,
  friday: attendanceDaySchema,
  saturday: attendanceDaySchema,
  sunday: attendanceDaySchema,
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
  days: attendanceDaysSchema,
});

export const updateAttendanceHoursResponseSchema = Type.Object({
  attendance_hours: attendanceHoursSchema,
  outside_hours_message: Type.Union([Type.String(), Type.Null()]),
  enabled: Type.Boolean(),
});

export type UpdateAttendanceHoursResponse = Static<
  typeof updateAttendanceHoursResponseSchema
>;
