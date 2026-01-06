import { Static, Type } from '@sinclair/typebox';

export const viewAiAgentRequestSchema = Type.Object({
  ai_agent_id: Type.String({ format: 'uuid' }),
});

export type ViewAiAgentRequest = Static<typeof viewAiAgentRequestSchema>;
