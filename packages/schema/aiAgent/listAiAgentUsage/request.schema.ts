import { Static, Type } from '@sinclair/typebox';

export const listAiAgentUsageRequestParamsSchema = Type.Object({
  ai_agent_id: Type.String({ format: 'uuid' }),
});

export type ListAiAgentUsageRequestParams = Static<
  typeof listAiAgentUsageRequestParamsSchema
>;
