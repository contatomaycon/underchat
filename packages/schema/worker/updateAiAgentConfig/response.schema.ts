import { Static, Type } from '@sinclair/typebox';

export const updateAiAgentConfigResponseSchema = Type.Object({
  ai_agent_id: Type.Union([Type.String(), Type.Null()]),
  enabled: Type.Boolean(),
});

export type UpdateAiAgentConfigResponse = Static<
  typeof updateAiAgentConfigResponseSchema
>;
