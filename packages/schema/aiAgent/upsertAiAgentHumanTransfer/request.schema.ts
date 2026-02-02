import { Static, Type } from '@sinclair/typebox';

export const upsertAiAgentHumanTransferParamsSchema = Type.Object({
  ai_agent_id: Type.String({ format: 'uuid' }),
});

export const upsertAiAgentHumanTransferBodySchema = Type.Object({
  enable_human_transfer: Type.Boolean(),
  sector_ids: Type.Array(Type.String({ format: 'uuid' })),
  user_ids: Type.Array(Type.String({ format: 'uuid' })),
});

export type UpsertAiAgentHumanTransferParams = Static<
  typeof upsertAiAgentHumanTransferParamsSchema
>;
export type UpsertAiAgentHumanTransferBody = Static<
  typeof upsertAiAgentHumanTransferBodySchema
>;
