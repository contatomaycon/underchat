import { pagingResponseSchema } from '@core/schema/common/pagingResponseSchema';
import { EPermissionRoleStatus } from '@core/common/enums/EPermissionRoleStatus';
import { Static, Type } from '@sinclair/typebox';

const roleAccountSchema = Type.Object({
  id: Type.String(),
  name: Type.Union([Type.String(), Type.Null()]),
});

export const listRoleResponseSchema = Type.Object({
  permission_role_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  description: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  status: Type.String({ enum: Object.values(EPermissionRoleStatus) }),
  account: Type.Optional(Type.Union([roleAccountSchema, Type.Null()])),
  created_at: Type.String(),
});

export const listRoleFinalResponseSchema = Type.Object({
  ...pagingResponseSchema.properties,
  results: Type.Array(listRoleResponseSchema),
});

export type ListRoleResponse = Static<typeof listRoleResponseSchema>;
export type ListRoleFinalResponse = Static<typeof listRoleFinalResponseSchema>;
