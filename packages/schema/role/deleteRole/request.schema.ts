import { Static, Type } from '@sinclair/typebox';

export const deleteRoleRequestSchema = Type.Object({
  permission_role_id: Type.String({ format: 'uuid' }),
});

export type DeleteRoleRequest = Static<typeof deleteRoleRequestSchema>;
