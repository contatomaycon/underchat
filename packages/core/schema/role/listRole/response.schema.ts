import { pagingResponseSchema } from '@core/schema/common/pagingResponseSchema';
import { Static, Type } from '@sinclair/typebox';

const roleAccountSchema = Type.Object({
  id: Type.String(),
  name: Type.Union([Type.String(), Type.Null()]),
});

export const listRoleResponseSchema = Type.Object({
  permission_role_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  account: Type.Optional(Type.Union([roleAccountSchema, Type.Null()])),
  created_at: Type.String(),
});

export const listRoleFinalResponseSchema = Type.Object({
  ...pagingResponseSchema.properties,
  results: Type.Array(listRoleResponseSchema),
});

export type ListRoleResponse = Static<typeof listRoleResponseSchema>;
export type ListRoleFinalResponse = Static<typeof listRoleFinalResponseSchema>;
