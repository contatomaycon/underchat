import { Static, Type } from '@sinclair/typebox';

export const blockAiAgentRequestSchema = Type.Object({
  ai_agent_id: Type.String({ format: 'uuid' }),
});

export type BlockAiAgentRequest = Static<typeof blockAiAgentRequestSchema>;
