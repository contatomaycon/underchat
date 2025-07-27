import { Static, Type } from '@sinclair/typebox';

export const createRoleResponseSchema = Type.Object({
  permission_role_id: Type.String({ format: 'uuid' }),
});

export type CreateRoleResponse = Static<typeof createRoleResponseSchema>;
