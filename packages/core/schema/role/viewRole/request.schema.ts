import { Static, Type } from '@sinclair/typebox';

export const viewRoleRequestSchema = Type.Object({
  permission_role_id: Type.Number(),
});

export type ViewRoleRequest = Static<typeof viewRoleRequestSchema>;
