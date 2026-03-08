import { Static, Type } from '@sinclair/typebox';

export const updateAiAgentConfigParamsSchema = Type.Object({
  worker_id: Type.String(),
});

export const updateAiAgentConfigRequestSchema = Type.Object({
  ai_agent_id: Type.Optional(
    Type.Union([Type.String({ format: 'uuid' }), Type.Null()])
  ),
  enabled: Type.Optional(Type.Boolean()),
});

export type UpdateAiAgentConfigParams = Static<
  typeof updateAiAgentConfigParamsSchema
>;
export type UpdateAiAgentConfigRequest = Static<
  typeof updateAiAgentConfigRequestSchema
>;
