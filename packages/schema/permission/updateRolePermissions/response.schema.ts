import { Static, Type } from '@sinclair/typebox';

export const updateRolePermissionsResponseSchema = Type.Object({
  success: Type.Boolean(),
});

export type UpdateRolePermissionsResponse = Static<
  typeof updateRolePermissionsResponseSchema
>;

