import { Static, Type } from '@sinclair/typebox';

const permissionActionRequestSchema = Type.Object({
  permission_action_id: Type.String({ format: 'uuid' }),
  action: Type.String(),
  selected: Type.Boolean(),
});

const permissionGroupRequestSchema = Type.Object({
  permission_action_group_id: Type.String({ format: 'uuid' }),
  action: Type.String(),
  selected: Type.Boolean(),
  permissions: Type.Array(permissionActionRequestSchema),
});

export const updateRolePermissionsParamsSchema = Type.Object({
  permission_role_id: Type.String({ format: 'uuid' }),
});

export const updateRolePermissionsBodySchema = Type.Object({
  groups: Type.Array(permissionGroupRequestSchema),
});

export type PermissionActionRequest = Static<
  typeof permissionActionRequestSchema
>;
export type PermissionGroupRequest = Static<
  typeof permissionGroupRequestSchema
>;
export type UpdateRolePermissionsParams = Static<
  typeof updateRolePermissionsParamsSchema
>;
export type UpdateRolePermissionsBody = Static<
  typeof updateRolePermissionsBodySchema
>;
