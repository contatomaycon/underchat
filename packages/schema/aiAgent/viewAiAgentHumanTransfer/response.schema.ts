import { Static, Type } from '@sinclair/typebox';

const sectorTargetItemSchema = Type.Object({
  sector_id: Type.String(),
  user_ids: Type.Array(Type.String()),
});

export const viewAiAgentHumanTransferResponseSchema = Type.Object({
  enable_human_transfer: Type.Boolean(),
  sector_targets: Type.Array(sectorTargetItemSchema),
});

export type ViewAiAgentHumanTransferResponse = Static<
  typeof viewAiAgentHumanTransferResponseSchema
>;
