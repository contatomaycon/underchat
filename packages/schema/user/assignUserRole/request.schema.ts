import { Static, Type } from '@sinclair/typebox';

export const assignUserRoleParamsRequestSchema = Type.Object({
  user_id: Type.String({ format: 'uuid' }),
});

export type AssignUserRoleParamsRequest = Static<
  typeof assignUserRoleParamsRequestSchema
>;

export const assignUserRoleRequestSchema = Type.Object({
  permission_role_id: Type.String({ format: 'uuid' }),
});

export type AssignUserRoleRequest = Static<typeof assignUserRoleRequestSchema>;
