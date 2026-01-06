import { Static, Type } from '@sinclair/typebox';
import { EAiAgentPromptType } from '@core/common/enums/EAiAgentPromptType';
import { EAiAgentStatus } from '@core/common/enums/EAiAgentStatus';

export const updateAiAgentPromptParamsSchema = Type.Object({
  ai_agent_prompt_id: Type.String({ format: 'uuid' }),
});

export const updateAiAgentPromptBodySchema = Type.Object({
  ai_agent_prompt_type: Type.Optional(
    Type.Union([
      Type.Literal(EAiAgentPromptType.file),
      Type.Literal(EAiAgentPromptType.text),
      Type.Null(),
    ])
  ),
  name: Type.Optional(
    Type.Union([Type.String({ minLength: 1, maxLength: 200 }), Type.Null()])
  ),
  value: Type.Optional(
    Type.Union([Type.String({ minLength: 1 }), Type.Null()])
  ),
  status: Type.Optional(
    Type.Union([
      Type.Literal(EAiAgentStatus.active),
      Type.Literal(EAiAgentStatus.inactive),
      Type.Null(),
    ])
  ),
});

export type UpdateAiAgentPromptParams = Static<
  typeof updateAiAgentPromptParamsSchema
>;
export type UpdateAiAgentPromptBody = Static<
  typeof updateAiAgentPromptBodySchema
>;
export type UpdateAiAgentPromptRequest = UpdateAiAgentPromptBody;
