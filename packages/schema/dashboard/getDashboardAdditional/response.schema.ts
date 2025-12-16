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
  sector_id: Type.String(),
  sector_name: Type.String(),
  count: Type.Number(),
});

const attendanceMetricsSchema = Type.Object({
  avg_response_time: Type.String(),
  avg_resolution_time: Type.String(),
  total_attendances: Type.Number(),
  productivity: Type.Number(),
});

const chatbotsSchema = Type.Object({
  total: Type.Number(),
  active: Type.Number(),
  allowed: Type.Number(),
});

export const getDashboardAdditionalResponseSchema = Type.Object({
  contacts_growth: Type.Array(contactsGrowthMonthlySchema),
  attendance_performance: Type.Array(attendancePerformanceSchema),
  sectors_distribution: Type.Array(sectorDistributionSchema),
  attendance_metrics: attendanceMetricsSchema,
  chatbots: chatbotsSchema,
  contact_groups: Type.Number(),
  message_templates: Type.Number(),
  label_templates: Type.Number(),
});

export type GetDashboardAdditionalResponse = Static<
  typeof getDashboardAdditionalResponseSchema
>;
