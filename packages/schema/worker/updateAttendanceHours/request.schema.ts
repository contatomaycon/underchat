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
  rules: Type.Array(attendanceRuleSchema),
  text: Type.Optional(Type.String({ maxLength: 2000 })),
});

export type UpdateAttendanceHoursParams = Static<
  typeof updateAttendanceHoursParamsSchema
>;
export type UpdateAttendanceHoursRequest = Static<
  typeof updateAttendanceHoursRequestSchema
>;
