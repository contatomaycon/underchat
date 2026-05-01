import { Static, Type } from '@sinclair/typebox';
import { internalChatConversationListResponseSchema } from '../common';

export const listConversationsResponseSchema = Type.Object({
  id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  status: Type.Boolean({ const: true }),
  message: Type.String(),
  data: internalChatConversationListResponseSchema,
});

export type ListConversationsResponse = Static<
  typeof listConversationsResponseSchema
>;
