import { Static, Type } from '@sinclair/typebox';
import { EAiAgentStatus } from '@core/common/enums/EAiAgentStatus';

export const viewAiAgentResponseSchema = Type.Object({
  ai_agent_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  base_url: Type.Union([Type.String(), Type.Null()]),
  api_key: Type.Union([Type.String(), Type.Null()]),
  model: Type.Union([Type.String(), Type.Null()]),
  chunk_size: Type.String(),
  chunk_overlap: Type.String(),
  status: Type.Union([
    Type.Literal(EAiAgentStatus.active),
    Type.Literal(EAiAgentStatus.inactive),
  ]),
  ai_agent_type_id: Type.String({ format: 'uuid' }),
  ai_agent_type_name: Type.String(),
  created_at: Type.Union([Type.String(), Type.Null()]),
  updated_at: Type.Union([Type.String(), Type.Null()]),
});

export type ViewAiAgentResponse = Static<typeof viewAiAgentResponseSchema>;
