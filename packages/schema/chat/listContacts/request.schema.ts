import { Static, Type } from '@sinclair/typebox';
import { pagingRequestSchema } from '@core/schema/common/pagingRequestSchema';

export const listChatContactsRequestSchema = Type.Object({
  ...pagingRequestSchema.properties,
  search: Type.Optional(Type.String()),
});

export type ListChatContactsRequest = Static<
  typeof listChatContactsRequestSchema
>;
