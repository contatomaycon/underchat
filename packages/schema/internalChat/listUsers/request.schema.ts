import { pagingRequestSchema } from '@core/schema/common/pagingRequestSchema';
import { Static, Type } from '@sinclair/typebox';

export const listUsersQuerySchema = Type.Object({
  ...pagingRequestSchema.properties,
  search: Type.Optional(Type.String()),
});

export const listUsersParamsSchema = Type.Object({});
export const listUsersBodySchema = Type.Object({});

export type ListUsersQuery = Static<typeof listUsersQuerySchema>;
