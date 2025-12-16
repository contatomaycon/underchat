import { Static, Type } from '@sinclair/typebox';

const userStatsSchema = Type.Object({
  total: Type.Number(),
  allowed: Type.Number(),
  sparkline_data: Type.Array(Type.Number()),
});

const channelStatsSchema = Type.Object({
  total: Type.Number(),
  connected: Type.Number(),
  allowed: Type.Number(),
  sparkline_data: Type.Array(Type.Number()),
});

const contactStatsSchema = Type.Object({
  total: Type.Number(),
  growth: Type.Number(),
  sparkline_data: Type.Array(Type.Number()),
});

export const getDashboardStatsResponseSchema = Type.Object({
  users: userStatsSchema,
  channels: channelStatsSchema,
  contacts: contactStatsSchema,
});

export type GetDashboardStatsResponse = Static<
  typeof getDashboardStatsResponseSchema
>;
