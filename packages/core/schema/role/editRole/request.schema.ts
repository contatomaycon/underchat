import { Static, Type } from '@sinclair/typebox';

export const editRoleRequestSchema = Type.Object({
  name: Type.String(),
});

export const editRoleParamsRequestSchema = Type.Object({
  permission_role_id: Type.Number(),
});

export type EditRoleRequest = Static<typeof editRoleRequestSchema>;
export type EditRoleParamsRequest = Static<typeof editRoleParamsRequestSchema>;
