import { Static, Type } from '@sinclair/typebox';
import { EAiAgentStatus } from '@core/common/enums/EAiAgentStatus';
import { uploadFileRequestSchema } from '@core/schema/upload/request.schema';

export const updateAiAgentPromptParamsSchema = Type.Object({
  ai_agent_prompt_id: Type.String({ format: 'uuid' }),
});

export const updateAiAgentPromptBodySchema = Type.Object({
  value: Type.Optional(
    Type.Object({
      value: Type.String({ minLength: 1 }),
    })
  ),
  file: Type.Optional(Type.Union([uploadFileRequestSchema, Type.Null()])),
  status: Type.Optional(
    Type.Object({
      value: Type.Union([
        Type.Literal(EAiAgentStatus.active),
        Type.Literal(EAiAgentStatus.inactive),
      ]),
    })
  ),
});

export type UpdateAiAgentPromptParams = Static<
  typeof updateAiAgentPromptParamsSchema
>;
export type UpdateAiAgentPromptBody = Static<
  typeof updateAiAgentPromptBodySchema
>;
export type UpdateAiAgentPromptRequest = UpdateAiAgentPromptBody;
