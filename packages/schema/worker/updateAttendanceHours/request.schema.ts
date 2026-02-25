import { Static, Type } from '@sinclair/typebox';

const attendanceDaySchema = Type.Object({
  enabled: Type.Boolean(),
  start_time: Type.Union([
    Type.String({ pattern: '^([01]\\d|2[0-3]):([0-5]\\d)$' }),
    Type.Null(),
  ]),
  end_time: Type.Union([
    Type.String({ pattern: '^([01]\\d|2[0-3]):([0-5]\\d)$' }),
    Type.Null(),
  ]),
});

export const updateAttendanceHoursParamsSchema = Type.Object({
  worker_id: Type.String(),
});

export const updateAttendanceHoursRequestSchema = Type.Object({
  enabled: Type.Boolean(),
  timezone: Type.String(),
  outside_hours_action: Type.Union([
    Type.Literal('continue_flow'),
    Type.Literal('message_only'),
  ]),
  message_only_destination_status: Type.Union([
    Type.Literal('queue'),
    Type.Literal('closed'),
  ]),
  message_only_queue_sector_id: Type.Optional(
    Type.Union([Type.String({ format: 'uuid' }), Type.Null()])
  ),
  days: Type.Object({
    monday: attendanceDaySchema,
    tuesday: attendanceDaySchema,
    wednesday: attendanceDaySchema,
    thursday: attendanceDaySchema,
    friday: attendanceDaySchema,
    saturday: attendanceDaySchema,
    sunday: attendanceDaySchema,
  }),
  text: Type.Optional(Type.String({ maxLength: 2000 })),
});

export type UpdateAttendanceHoursParams = Static<
  typeof updateAttendanceHoursParamsSchema
>;
export type UpdateAttendanceHoursRequest = Static<
  typeof updateAttendanceHoursRequestSchema
>;
