import { Static, Type } from '@sinclair/typebox';

export const createAiAgentPromptResponseSchema = Type.Object({
  ai_agent_prompt_id: Type.String({ format: 'uuid' }),
});

export type CreateAiAgentPromptResponse = Static<
  typeof createAiAgentPromptResponseSchema
>;
