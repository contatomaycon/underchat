import { Static, Type } from '@sinclair/typebox';
import { EAiAgentStatus } from '@core/common/enums/EAiAgentStatus';

export const updateAiAgentParamsSchema = Type.Object({
  ai_agent_id: Type.String({ format: 'uuid' }),
});

export const updateAiAgentBodySchema = Type.Object({
  ai_agent_type_id: Type.Optional(
    Type.Union([Type.String({ format: 'uuid' }), Type.Null()])
  ),
  name: Type.Optional(
    Type.Union([Type.String({ minLength: 1, maxLength: 200 }), Type.Null()])
  ),
  base_url: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  api_key: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  status: Type.Optional(
    Type.Union([
      Type.Literal(EAiAgentStatus.active),
      Type.Literal(EAiAgentStatus.inactive),
      Type.Null(),
    ])
  ),
});

export type UpdateAiAgentParams = Static<typeof updateAiAgentParamsSchema>;
export type UpdateAiAgentBody = Static<typeof updateAiAgentBodySchema>;
export type UpdateAiAgentRequest = UpdateAiAgentBody;
