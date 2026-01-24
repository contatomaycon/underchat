import { Static, Type } from '@sinclair/typebox';

export const reportSatisfactionOptionCountSchema = Type.Object({
  option_id: Type.String(),
  option_text: Type.String(),
  count: Type.Number(),
});

export const reportSatisfactionResultSchema = Type.Object({
  period: Type.String(),
  sector: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  analyst: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  satisfaction_key: Type.String(),
  question: Type.String(),
  options: Type.Array(
    Type.Object({
      id: Type.String(),
      text: Type.String(),
    })
  ),
  total: Type.Number(),
  option_counts: Type.Array(reportSatisfactionOptionCountSchema),
});

export const reportSatisfactionSummarySchema = Type.Object({
  total_responses: Type.Number(),
  unique_satisfactions: Type.Number(),
});

export const listReportSatisfactionFinalResponseSchema = Type.Object({
  summary: reportSatisfactionSummarySchema,
  results: Type.Array(reportSatisfactionResultSchema),
});

export type ReportSatisfactionOptionCount = Static<
  typeof reportSatisfactionOptionCountSchema
>;
export type ReportSatisfactionResult = Static<
  typeof reportSatisfactionResultSchema
>;
export type ReportSatisfactionSummary = Static<
  typeof reportSatisfactionSummarySchema
>;
export type ListReportSatisfactionFinalResponse = Static<
  typeof listReportSatisfactionFinalResponseSchema
>;
