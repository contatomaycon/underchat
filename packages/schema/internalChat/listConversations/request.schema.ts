import { pagingRequestSchema } from '@core/schema/common/pagingRequestSchema';
import { Static, Type } from '@sinclair/typebox';

export const listConversationsQuerySchema = Type.Object({
  ...pagingRequestSchema.properties,
  search: Type.Optional(Type.String()),
});

export type ListConversationsQuery = Static<
  typeof listConversationsQuerySchema
>;
