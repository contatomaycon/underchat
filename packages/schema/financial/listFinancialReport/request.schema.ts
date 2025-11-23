import { Static, Type } from '@sinclair/typebox';

export const listFinancialReportRequestSchema = Type.Object({
  view_type: Type.Union([
    Type.Literal('annual'),
    Type.Literal('monthly'),
    Type.Literal('daily'),
  ]),
  date_from: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  date_to: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export type ListFinancialReportRequest = Static<
  typeof listFinancialReportRequestSchema
>;
