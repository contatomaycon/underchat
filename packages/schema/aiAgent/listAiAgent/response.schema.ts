import { pagingResponseSchema } from '@core/schema/common/pagingResponseSchema';
import { Static, Type } from '@sinclair/typebox';
import { EAiAgentStatus } from '@core/common/enums/EAiAgentStatus';

export const listAiAgentResponseSchema = Type.Object({
  ai_agent_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  base_url: Type.Union([Type.String(), Type.Null()]),
  status: Type.Union([
    Type.Literal(EAiAgentStatus.active),
    Type.Literal(EAiAgentStatus.inactive),
  ]),
  ai_agent_type_id: Type.String({ format: 'uuid' }),
  ai_agent_type_name: Type.String(),
  created_at: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export const listAiAgentFinalResponseSchema = Type.Object({
  ...pagingResponseSchema.properties,
  results: Type.Array(listAiAgentResponseSchema),
});

export type ListAiAgentResponse = Static<typeof listAiAgentResponseSchema>;
export type ListAiAgentFinalResponse = Static<
  typeof listAiAgentFinalResponseSchema
>;
