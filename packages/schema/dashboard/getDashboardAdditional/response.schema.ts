import { Static, Type } from '@sinclair/typebox';

const contactsGrowthMonthlySchema = Type.Object({
  month: Type.String(),
  total: Type.Number(),
});

const attendancePerformanceSchema = Type.Object({
  day: Type.String(),
  performed: Type.Number(),
  average: Type.Number(),
});

const sectorDistributionSchema = Type.Object({
  sectorId: Type.String(),
  sectorName: Type.String(),
  count: Type.Number(),
});

const attendanceMetricsSchema = Type.Object({
  avgResponseTime: Type.String(),
  avgResolutionTime: Type.String(),
  totalAttendances: Type.Number(),
  productivity: Type.Number(),
});

const chatbotsSchema = Type.Object({
  total: Type.Number(),
  active: Type.Number(),
});

export const getDashboardAdditionalResponseSchema = Type.Object({
  contactsGrowth: Type.Array(contactsGrowthMonthlySchema),
  attendancePerformance: Type.Array(attendancePerformanceSchema),
  sectorsDistribution: Type.Array(sectorDistributionSchema),
  attendanceMetrics: attendanceMetricsSchema,
  chatbots: chatbotsSchema,
  contactGroups: Type.Number(),
  messageTemplates: Type.Number(),
  labelTemplates: Type.Number(),
});

export type GetDashboardAdditionalResponse = Static<
  typeof getDashboardAdditionalResponseSchema
>;
