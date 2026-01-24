import { Static, Type } from '@sinclair/typebox';

export const listReportSatisfactionRequestSchema = Type.Object({
  report_type: Type.Union([
    Type.Literal('general'),
    Type.Literal('sector'),
    Type.Literal('analyst'),
  ]),
  period: Type.Union([
    Type.Literal('month'),
    Type.Literal('week'),
    Type.Literal('day'),
    Type.Literal('hour'),
  ]),
  start_date: Type.String({ format: 'date-time' }),
  end_date: Type.String({ format: 'date-time' }),
  sector_id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  analyst_id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export type ListReportSatisfactionRequest = Static<
  typeof listReportSatisfactionRequestSchema
>;
