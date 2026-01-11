import { Static, Type } from '@sinclair/typebox';

export const refreshAiAgentPromptRequestSchema = Type.Object({
  ai_agent_prompt_id: Type.String({ format: 'uuid' }),
});

export type RefreshAiAgentPromptRequest = Static<
  typeof refreshAiAgentPromptRequestSchema
>;
