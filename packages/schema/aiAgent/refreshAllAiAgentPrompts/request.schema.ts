import { Static, Type } from '@sinclair/typebox';

export const refreshAllAiAgentPromptsRequestSchema = Type.Object({
  ai_agent_id: Type.String({ format: 'uuid' }),
});

export type RefreshAllAiAgentPromptsRequest = Static<
  typeof refreshAllAiAgentPromptsRequestSchema
>;
