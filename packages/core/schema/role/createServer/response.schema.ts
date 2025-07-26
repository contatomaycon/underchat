import { Static, Type } from '@sinclair/typebox';

export const createRoleResponseSchema = Type.Object({
  permission_role_id: Type.Number(),
});

export type CreateRoleResponse = Static<typeof createRoleResponseSchema>;
