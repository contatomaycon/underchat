import { Static, Type } from '@sinclair/typebox';

export const listAiAgentTypeResponseSchema = Type.Object({
  ai_agent_type_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
});

export type ListAiAgentTypeResponse = Static<
  typeof listAiAgentTypeResponseSchema
>;
