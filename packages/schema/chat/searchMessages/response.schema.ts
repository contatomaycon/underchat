import { Static, Type } from '@sinclair/typebox';
import { pagingResponseSchema } from '@core/schema/common/pagingResponseSchema';

export const searchMessagesResultSchema = Type.Object({
  message_id: Type.String(),
  date: Type.String(),
  message: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export const searchMessagesResponseSchema = Type.Object({
  results: Type.Array(searchMessagesResultSchema),
  ...pagingResponseSchema.properties,
});

export type SearchMessagesResult = Static<typeof searchMessagesResultSchema>;
export type SearchMessagesResponse = Static<
  typeof searchMessagesResponseSchema
>;
