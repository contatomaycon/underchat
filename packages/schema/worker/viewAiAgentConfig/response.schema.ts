import { Static, Type } from '@sinclair/typebox';

export const viewAiAgentConfigResponseSchema = Type.Object({
  ai_agent_id: Type.Union([Type.String(), Type.Null()]),
  enabled: Type.Boolean(),
});

export type ViewAiAgentConfigResponse = Static<
  typeof viewAiAgentConfigResponseSchema
>;
