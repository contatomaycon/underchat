import { Static, Type } from '@sinclair/typebox';

export const viewRoleResponseSchema = Type.Object({
  permission_role_id: Type.Number(),
  name: Type.String(),
  created_at: Type.String(),
});

export type ViewRoleResponse = Static<typeof viewRoleResponseSchema>;
