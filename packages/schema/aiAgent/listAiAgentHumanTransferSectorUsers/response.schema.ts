import { Static, Type } from '@sinclair/typebox';

export const listAiAgentHumanTransferSectorUserItemSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  last_name: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  nickname: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export type ListAiAgentHumanTransferSectorUserItem = Static<
  typeof listAiAgentHumanTransferSectorUserItemSchema
>;

export const listAiAgentHumanTransferSectorUsersResponseSchema = Type.Array(
  listAiAgentHumanTransferSectorUserItemSchema
);

export type ListAiAgentHumanTransferSectorUsersResponse = Static<
  typeof listAiAgentHumanTransferSectorUsersResponseSchema
>;
