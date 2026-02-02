import { Static, Type } from '@sinclair/typebox';

export const listAiAgentHumanTransferSectorUsersParamsSchema = Type.Object({
  sector_id: Type.String({ format: 'uuid' }),
});

export type ListAiAgentHumanTransferSectorUsersParams = Static<
  typeof listAiAgentHumanTransferSectorUsersParamsSchema
>;
