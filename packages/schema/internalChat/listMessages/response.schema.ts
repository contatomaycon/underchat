import { Static, Type } from '@sinclair/typebox';
import { internalChatMessageListResponseSchema } from '../common';

export const listMessagesResponseSchema = Type.Object({
  id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  status: Type.Boolean({ const: true }),
  message: Type.String(),
  data: internalChatMessageListResponseSchema,
});

export type ListMessagesResponse = Static<typeof listMessagesResponseSchema>;
