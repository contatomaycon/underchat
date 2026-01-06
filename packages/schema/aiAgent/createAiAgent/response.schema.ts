import { Static, Type } from '@sinclair/typebox';

export const createAiAgentResponseSchema = Type.Object({
  ai_agent_id: Type.String({ format: 'uuid' }),
});

export type CreateAiAgentResponse = Static<typeof createAiAgentResponseSchema>;
