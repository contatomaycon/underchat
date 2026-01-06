import { Static, Type } from '@sinclair/typebox';
import { EAiAgentPromptType } from '@core/common/enums/EAiAgentPromptType';
import { EAiAgentStatus } from '@core/common/enums/EAiAgentStatus';

export const createAiAgentPromptRequestSchema = Type.Object({
  ai_agent_id: Type.String({ format: 'uuid' }),
  ai_agent_prompt_type: Type.Union([
    Type.Literal(EAiAgentPromptType.file),
    Type.Literal(EAiAgentPromptType.text),
  ]),
  name: Type.String({ minLength: 1, maxLength: 200 }),
  value: Type.String({ minLength: 1 }),
  status: Type.Optional(
    Type.Union([
      Type.Literal(EAiAgentStatus.active),
      Type.Literal(EAiAgentStatus.inactive),
    ])
  ),
});

export type CreateAiAgentPromptRequest = Static<
  typeof createAiAgentPromptRequestSchema
>;
