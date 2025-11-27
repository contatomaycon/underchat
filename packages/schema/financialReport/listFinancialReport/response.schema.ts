import { Static, Type } from '@sinclair/typebox';

const monthlyDetailSchema = Type.Object({
  month: Type.String(),
  income: Type.String(),
  outgoing: Type.String(),
  net: Type.String(),
});

const dailyDetailSchema = Type.Object({
  date: Type.String(),
  income: Type.String(),
  outgoing: Type.String(),
  net: Type.String(),
});

export const listFinancialReportResponseSchema = Type.Object({
  total_income: Type.String(),
  total_outgoing: Type.String(),
  total_net: Type.String(),
  monthly_details: Type.Optional(Type.Array(monthlyDetailSchema)),
  daily_details: Type.Optional(Type.Array(dailyDetailSchema)),
});

export type MonthlyDetail = Static<typeof monthlyDetailSchema>;
export type DailyDetail = Static<typeof dailyDetailSchema>;
export type ListFinancialReportResponse = Static<
  typeof listFinancialReportResponseSchema
>;
