import { Static, Type } from '@sinclair/typebox';
import { EAiAgentStatus } from '@core/common/enums/EAiAgentStatus';

export const viewAiAgentPromptResponseSchema = Type.Object({
  ai_agent_prompt_id: Type.String({ format: 'uuid' }),
  ai_agent_id: Type.String({ format: 'uuid' }),
  value: Type.String(),
  openai_file_id: Type.Union([Type.String(), Type.Null()]),
  status: Type.Union([
    Type.Literal(EAiAgentStatus.active),
    Type.Literal(EAiAgentStatus.inactive),
  ]),
  created_at: Type.Union([Type.String(), Type.Null()]),
  updated_at: Type.Union([Type.String(), Type.Null()]),
});

export type ViewAiAgentPromptResponse = Static<
  typeof viewAiAgentPromptResponseSchema
>;
