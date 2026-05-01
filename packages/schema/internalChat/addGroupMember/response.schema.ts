import { Static, Type } from '@sinclair/typebox';
import { internalChatConversationSchema } from '../common';

export const addGroupMemberResponseSchema = Type.Object({
  id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  status: Type.Boolean({ const: true }),
  message: Type.String(),
  data: internalChatConversationSchema,
});

export type AddGroupMemberResponse = Static<
  typeof addGroupMemberResponseSchema
>;
