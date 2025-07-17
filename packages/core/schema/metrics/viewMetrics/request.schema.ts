import { Static, Type } from '@sinclair/typebox';

export const viewMetricsRequestSchema = Type.Object({
  port: Type.Number(),
});

export type ViewMetricsRequest = Static<typeof viewMetricsRequestSchema>;
