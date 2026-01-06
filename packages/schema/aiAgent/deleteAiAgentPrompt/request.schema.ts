import { Static, Type } from '@sinclair/typebox';

export const deleteAiAgentPromptRequestSchema = Type.Object({
  ai_agent_prompt_id: Type.String({ format: 'uuid' }),
});

export type DeleteAiAgentPromptRequest = Static<
  typeof deleteAiAgentPromptRequestSchema
>;
