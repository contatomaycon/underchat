import { Static, Type } from '@sinclair/typebox';
import { EAiAgentPromptType } from '@core/common/enums/EAiAgentPromptType';
import { EAiAgentStatus } from '@core/common/enums/EAiAgentStatus';
import { uploadFileRequestSchema } from '@core/schema/upload/request.schema';

export const createAiAgentPromptRequestSchema = Type.Object({
  ai_agent_id: Type.Union([
    Type.Object({
      value: Type.String({ format: 'uuid' }),
    }),
  ]),
  ai_agent_prompt_type: Type.Union([
    Type.Object({
      value: Type.Union([
        Type.Literal(EAiAgentPromptType.file),
        Type.Literal(EAiAgentPromptType.text),
      ]),
    }),
  ]),
  name: Type.Union([
    Type.Object({
      value: Type.String({ minLength: 1, maxLength: 200 }),
    }),
  ]),
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

export type CreateAiAgentPromptRequest = Static<
  typeof createAiAgentPromptRequestSchema
>;
