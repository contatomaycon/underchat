import { Static, Type } from '@sinclair/typebox';
import { internalChatParticipantSchema } from '../common';

export const listGroupMembersResponseSchema = Type.Object({
  id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  status: Type.Boolean({ const: true }),
  message: Type.String(),
  data: Type.Array(internalChatParticipantSchema),
});

export type ListGroupMembersResponse = Static<
  typeof listGroupMembersResponseSchema
>;
