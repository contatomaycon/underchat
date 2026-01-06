import { Static, Type } from '@sinclair/typebox';
import { EAiAgentStatus } from '@core/common/enums/EAiAgentStatus';

export const createAiAgentRequestSchema = Type.Object({
  ai_agent_type_id: Type.String({ format: 'uuid' }),
  name: Type.String({ minLength: 1, maxLength: 200 }),
  base_url: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  api_key: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  status: Type.Optional(
    Type.Union([
      Type.Literal(EAiAgentStatus.active),
      Type.Literal(EAiAgentStatus.inactive),
    ])
  ),
});

export type CreateAiAgentRequest = Static<typeof createAiAgentRequestSchema>;
