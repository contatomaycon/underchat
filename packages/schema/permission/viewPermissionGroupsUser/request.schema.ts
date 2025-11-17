import { Static, Type } from '@sinclair/typebox';

export const viewPermissionGroupsUserParamsSchema = Type.Object({
  user_id: Type.String({ format: 'uuid' }),
});

export type ViewPermissionGroupsUserParams = Static<
  typeof viewPermissionGroupsUserParamsSchema
>;
