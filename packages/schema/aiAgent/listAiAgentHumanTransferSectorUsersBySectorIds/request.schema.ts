import { Static, Type } from '@sinclair/typebox';

export const listAiAgentHumanTransferSectorUsersBySectorIdsQuerySchema =
  Type.Object({
    sector_ids: Type.Array(Type.String({ format: 'uuid' }), {
      minItems: 1,
    }),
  });

export type ListAiAgentHumanTransferSectorUsersBySectorIdsQuery = Static<
  typeof listAiAgentHumanTransferSectorUsersBySectorIdsQuerySchema
>;
