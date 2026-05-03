import { pagingResponseSchema } from '@core/schema/common/pagingResponseSchema';
import { Static, Type } from '@sinclair/typebox';

export const searchInternalChatMessagesResultSchema = Type.Object({
  message_id: Type.String(),
  date: Type.String(),
  message: Type.Union([Type.String(), Type.Null()]),
});

export const searchInternalChatMessagesDataSchema = Type.Object({
  results: Type.Array(searchInternalChatMessagesResultSchema),
  ...pagingResponseSchema.properties,
});

export const searchInternalChatMessagesResponseSchema = Type.Object({
  id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  status: Type.Boolean({ const: true }),
  message: Type.String(),
  data: searchInternalChatMessagesDataSchema,
});

export type SearchInternalChatMessagesResult = Static<
  typeof searchInternalChatMessagesResultSchema
>;
export type SearchInternalChatMessagesResponse = Static<
  typeof searchInternalChatMessagesDataSchema
>;
