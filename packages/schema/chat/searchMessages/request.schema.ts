import { Static, Type } from '@sinclair/typebox';
import { pagingRequestSchema } from '@core/schema/common/pagingRequestSchema';

export const searchMessagesParamsSchema = Type.Object({
  chat_id: Type.String({ format: 'uuid' }),
});

export const searchMessagesQuerySchema = Type.Object({
  search: Type.String({ minLength: 3 }),
  ...pagingRequestSchema.properties,
});

export type SearchMessagesParams = Static<typeof searchMessagesParamsSchema>;
export type SearchMessagesQuery = Static<typeof searchMessagesQuerySchema>;
