import { Static, Type } from '@sinclair/typebox';

export const viewAiAgentHumanTransferResponseSchema = Type.Object({
  enable_human_transfer: Type.Boolean(),
  sector_ids: Type.Array(Type.String({ format: 'uuid' })),
  user_ids: Type.Array(Type.String({ format: 'uuid' })),
});

export type ViewAiAgentHumanTransferResponse = Static<
  typeof viewAiAgentHumanTransferResponseSchema
>;
