import { Static, Type } from '@sinclair/typebox';

export const deleteRoleRequestSchema = Type.Object({
  permission_role_id: Type.Number(),
});

export type DeleteRoleRequest = Static<typeof deleteRoleRequestSchema>;
