import { Static, Type } from '@sinclair/typebox';

export const listReportAttendanceRequestSchema = Type.Object({
  report_type: Type.Union([
    Type.Literal('queue'),
    Type.Literal('analyst'),
    Type.Literal('general'),
  ]),
  period: Type.Union([
    Type.Literal('month'),
    Type.Literal('week'),
    Type.Literal('day'),
    Type.Literal('hour'),
  ]),
  start_date: Type.String({ format: 'date-time' }),
  end_date: Type.String({ format: 'date-time' }),
  queue_id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  analyst_id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export type ListReportAttendanceRequest = Static<
  typeof listReportAttendanceRequestSchema
>;
