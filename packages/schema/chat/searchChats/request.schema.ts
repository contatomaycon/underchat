import { Static, Type } from '@sinclair/typebox';
import { pagingRequestSchema } from '@core/schema/common/pagingRequestSchema';

export const searchChatsQuerySchema = Type.Object({
  ...pagingRequestSchema.properties,
  search: Type.String({ minLength: 1 }),
});

export type SearchChatsQuery = Static<typeof searchChatsQuerySchema>;
