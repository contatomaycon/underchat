import { Static, Type } from '@sinclair/typebox';

export const deleteAiAgentRequestSchema = Type.Object({
  ai_agent_id: Type.String({ format: 'uuid' }),
});

export type DeleteAiAgentRequest = Static<typeof deleteAiAgentRequestSchema>;
