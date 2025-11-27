import { Static, Type } from '@sinclair/typebox';

export const listFinancialReportRequestSchema = Type.Object({
  start_date: Type.Optional(
    Type.Union([Type.String({ format: 'date-time' }), Type.Null()])
  ),
  end_date: Type.Optional(
    Type.Union([Type.String({ format: 'date-time' }), Type.Null()])
  ),
  period: Type.Union([
    Type.Literal('annual'),
    Type.Literal('monthly'),
    Type.Literal('daily'),
  ]),
});

export type ListFinancialReportRequest = Static<
  typeof listFinancialReportRequestSchema
>;
