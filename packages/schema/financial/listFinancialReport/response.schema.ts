import { Static, Type } from '@sinclair/typebox';

export const financialReportItemSchema = Type.Object({
  date: Type.Optional(Type.String()),
  month: Type.Optional(Type.String()),
  income: Type.String(),
  expense: Type.String(),
  net: Type.String(),
});

export const financialReportAnnualSchema = Type.Object({
  annual_income: Type.String(),
  annual_expense: Type.String(),
  annual_net: Type.String(),
  monthly_breakdown: Type.Array(financialReportItemSchema),
});

export const listFinancialReportResponseSchema = Type.Union([
  financialReportAnnualSchema,
  Type.Array(financialReportItemSchema),
]);

export type FinancialReportItem = Static<typeof financialReportItemSchema>;
export type FinancialReportAnnual = Static<typeof financialReportAnnualSchema>;
export type ListFinancialReportResponse = Static<
  typeof listFinancialReportResponseSchema
>;
