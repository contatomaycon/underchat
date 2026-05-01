import { Static, Type } from '@sinclair/typebox';
import { internalChatConversationSchema } from '../common';

export const updateGroupResponseSchema = Type.Object({
  id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  status: Type.Boolean({ const: true }),
  message: Type.String(),
  data: internalChatConversationSchema,
});

export type UpdateGroupResponse = Static<typeof updateGroupResponseSchema>;
