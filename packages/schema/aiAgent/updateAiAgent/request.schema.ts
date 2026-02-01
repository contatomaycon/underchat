import { Static, Type } from '@sinclair/typebox';
import { EAiAgentStatus } from '@core/common/enums/EAiAgentStatus';

export const updateAiAgentParamsSchema = Type.Object({
  ai_agent_id: Type.String({ format: 'uuid' }),
});

export const updateAiAgentBodySchema = Type.Object({
  name: Type.Optional(
    Type.Union([Type.String({ minLength: 1, maxLength: 200 }), Type.Null()])
  ),
  base_url: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  api_key: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  model: Type.Optional(
    Type.Union([Type.String({ minLength: 1, maxLength: 100 }), Type.Null()])
  ),
  embedding_model: Type.Optional(
    Type.Union([Type.String({ minLength: 1, maxLength: 100 }), Type.Null()])
  ),
  chunk_size: Type.Optional(
    Type.Union([Type.String({ minLength: 1, maxLength: 10 }), Type.Null()])
  ),
  chunk_overlap: Type.Optional(
    Type.Union([Type.String({ minLength: 1, maxLength: 10 }), Type.Null()])
  ),
  status: Type.Optional(
    Type.Union([
      Type.Literal(EAiAgentStatus.active),
      Type.Literal(EAiAgentStatus.inactive),
      Type.Null(),
    ])
  ),
  voice_ia_id: Type.Optional(
    Type.Union([Type.String({ format: 'uuid' }), Type.Null()])
  ),
});

export type UpdateAiAgentParams = Static<typeof updateAiAgentParamsSchema>;
export type UpdateAiAgentBody = Static<typeof updateAiAgentBodySchema>;
export type UpdateAiAgentRequest = UpdateAiAgentBody;
