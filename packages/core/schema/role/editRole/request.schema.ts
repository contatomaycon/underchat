import { Static, Type } from '@sinclair/typebox';

export const editRoleParamsRequestSchema = Type.Object({
  permission_role_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
});

export type EditRoleParamsRequest = Static<typeof editRoleParamsRequestSchema>;
