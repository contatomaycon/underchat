import { Static, Type } from '@sinclair/typebox';

export const unblockAiAgentRequestSchema = Type.Object({
  ai_agent_id: Type.String({ format: 'uuid' }),
});

export type UnblockAiAgentRequest = Static<typeof unblockAiAgentRequestSchema>;
