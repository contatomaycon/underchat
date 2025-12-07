import { Static, Type } from '@sinclair/typebox';

export const reportAttendanceResultSchema = Type.Object({
  period: Type.String(),
  queue: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  analyst: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  total: Type.Number(),
  totalTime: Type.String(),
  averageWait: Type.String(),
  averageTime: Type.Optional(Type.String()),
  categories: Type.Optional(Type.Record(Type.String(), Type.Number())),
});

export const listReportAttendanceFinalResponseSchema = Type.Object({
  results: Type.Array(reportAttendanceResultSchema),
});

export type ReportAttendanceResult = Static<
  typeof reportAttendanceResultSchema
>;
export type ListReportAttendanceFinalResponse = Static<
  typeof listReportAttendanceFinalResponseSchema
>;
