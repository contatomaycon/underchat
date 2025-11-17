import { Static, Type } from '@sinclair/typebox';

export const viewPermissionGroupsUserParamsSchema = Type.Object({
  permission_role_id: Type.String({ format: 'uuid' }),
});

export type ViewPermissionGroupsUserParams = Static<
  typeof viewPermissionGroupsUserParamsSchema
>;
