import { pagingResponseSchema } from '@core/schema/common/pagingResponseSchema';
import { Static, Type } from '@sinclair/typebox';

export const listAiAgentUsageResponseItemSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  prompt_tokens: Type.Union([Type.Number(), Type.Null()]),
  completion_tokens: Type.Union([Type.Number(), Type.Null()]),
  total_tokens: Type.Union([Type.Number(), Type.Null()]),
  model: Type.Union([Type.String(), Type.Null()]),
  latency_ms: Type.Union([Type.Number(), Type.Null()]),
  success: Type.Union([Type.Boolean(), Type.Null()]),
  created_at: Type.Union([Type.String(), Type.Null()]),
});

export const listAiAgentUsageFinalResponseSchema = Type.Object({
  ...pagingResponseSchema.properties,
  results: Type.Array(listAiAgentUsageResponseItemSchema),
});

export type ListAiAgentUsageResponseItem = Static<
  typeof listAiAgentUsageResponseItemSchema
>;
export type ListAiAgentUsageFinalResponse = Static<
  typeof listAiAgentUsageFinalResponseSchema
>;
