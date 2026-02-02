import { Static, Type } from '@sinclair/typebox';

export const upsertAiAgentHumanTransferResponseSchema = Type.Object({
  success: Type.Boolean(),
});

export type UpsertAiAgentHumanTransferResponse = Static<
  typeof upsertAiAgentHumanTransferResponseSchema
>;
