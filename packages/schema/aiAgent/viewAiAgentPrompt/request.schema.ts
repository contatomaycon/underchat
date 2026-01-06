import { Static, Type } from '@sinclair/typebox';

export const viewAiAgentPromptRequestSchema = Type.Object({
  ai_agent_prompt_id: Type.String({ format: 'uuid' }),
});

export type ViewAiAgentPromptRequest = Static<
  typeof viewAiAgentPromptRequestSchema
>;
