import { Static, Type } from '@sinclair/typebox';

export const listAiAgentPromptRequestSchema = Type.Object({
  ai_agent_id: Type.String({ format: 'uuid' }),
});

export type ListAiAgentPromptRequest = Static<
  typeof listAiAgentPromptRequestSchema
>;
