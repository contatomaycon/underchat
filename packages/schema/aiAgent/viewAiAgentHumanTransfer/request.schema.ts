import { Static, Type } from '@sinclair/typebox';

export const viewAiAgentHumanTransferParamsSchema = Type.Object({
  ai_agent_id: Type.String({ format: 'uuid' }),
});

export type ViewAiAgentHumanTransferParams = Static<
  typeof viewAiAgentHumanTransferParamsSchema
>;
