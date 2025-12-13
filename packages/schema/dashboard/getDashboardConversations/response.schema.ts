import { Static, Type } from '@sinclair/typebox';

const evolutionDataSchema = Type.Object({
  month: Type.String(),
  active: Type.Number(),
  closed: Type.Number(),
});

export const getDashboardConversationsResponseSchema = Type.Object({
  active: Type.Number(),
  closed: Type.Number(),
  sparklineData: Type.Array(Type.Number()),
  evolution: Type.Array(evolutionDataSchema),
});

export type GetDashboardConversationsResponse = Static<
  typeof getDashboardConversationsResponseSchema
>;
