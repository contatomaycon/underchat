import { Static, Type } from '@sinclair/typebox';

export const listAiAgentHumanTransferSectorItemSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  color: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export type ListAiAgentHumanTransferSectorItem = Static<
  typeof listAiAgentHumanTransferSectorItemSchema
>;

export const listAiAgentHumanTransferSectorsResponseSchema = Type.Array(
  listAiAgentHumanTransferSectorItemSchema
);

export type ListAiAgentHumanTransferSectorsResponse = Static<
  typeof listAiAgentHumanTransferSectorsResponseSchema
>;
