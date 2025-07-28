import { pagingRequestSchema } from '@core/schema/common/pagingRequestSchema';
import { sortRequestSchema } from '@core/schema/common/sortRequestSchema';
import { Static, Type } from '@sinclair/typebox';

export const listRoleRequestSchema = Type.Object({
  ...pagingRequestSchema.properties,
  sort_by: Type.Optional(Type.Array(sortRequestSchema)),
  role_name: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  account: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export type ListRoleRequest = Static<typeof listRoleRequestSchema>;
