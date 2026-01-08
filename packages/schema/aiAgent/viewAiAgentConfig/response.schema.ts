import { Static, Type } from '@sinclair/typebox';

export const viewAiAgentConfigResponseSchema = Type.Object({
  ai_agent: Type.Union([Type.Integer(), Type.Null()]),
  enabled: Type.Boolean(),
  total: Type.Integer(),
});

export type ViewAiAgentConfigResponse = Static<
  typeof viewAiAgentConfigResponseSchema
>;
