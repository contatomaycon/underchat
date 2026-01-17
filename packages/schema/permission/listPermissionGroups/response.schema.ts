import { Static, Type } from '@sinclair/typebox';

const permissionActionSchema = Type.Object({
  permission_action_id: Type.String({ format: 'uuid' }),
  action: Type.String(),
  name: Type.String(),
  description: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  created_at: Type.String(),
  updated_at: Type.String(),
});

const permissionActionGroupSchema = Type.Object({
  permission_action_group_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  description: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  action: Type.String(),
  created_at: Type.String(),
  updated_at: Type.String(),
  selected: Type.Boolean(),
  permissions: Type.Array(permissionActionSchema),
});

export const listPermissionGroupsResponseSchema = Type.Array(
  permissionActionGroupSchema
);

export type PermissionActionResponse = Static<typeof permissionActionSchema>;
export type PermissionActionGroupResponse = Static<
  typeof permissionActionGroupSchema
>;
export type ListPermissionGroupsResponse = Static<
  typeof listPermissionGroupsResponseSchema
>;
