import { Static, Type } from '@sinclair/typebox';
import { EAiAgentStatus } from '@core/common/enums/EAiAgentStatus';

export const createAiAgentRequestSchema = Type.Object({
  ai_agent_type_id: Type.String({ format: 'uuid' }),
  name: Type.String({ minLength: 1, maxLength: 200 }),
  base_url: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  api_key: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  model: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
  embedding_model: Type.Optional(
    Type.Union([Type.String({ minLength: 1, maxLength: 100 }), Type.Null()])
  ),
  chunk_size: Type.Optional(Type.String({ minLength: 1, maxLength: 10 })),
  chunk_overlap: Type.Optional(Type.String({ minLength: 1, maxLength: 10 })),
  status: Type.Optional(
    Type.Union([
      Type.Literal(EAiAgentStatus.active),
      Type.Literal(EAiAgentStatus.inactive),
    ])
  ),
  system_prompt: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  enable_human_transfer: Type.Optional(Type.Boolean()),
  voice_ia_id: Type.Optional(
    Type.Union([Type.String({ format: 'uuid' }), Type.Null()])
  ),
});

export type CreateAiAgentRequest = Static<typeof createAiAgentRequestSchema>;
