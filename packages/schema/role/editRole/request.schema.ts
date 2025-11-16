import { Static, Type } from '@sinclair/typebox';

export const editRoleParamsRequestSchema = Type.Object({
  permission_role_id: Type.String({ format: 'uuid' }),
});

export type EditRoleParamsRequest = Static<typeof editRoleParamsRequestSchema>;

export const updateRoleRequestSchema = Type.Object({
  name: Type.String(),
  description: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export type UpdateRoleRequest = Static<typeof updateRoleRequestSchema>;
