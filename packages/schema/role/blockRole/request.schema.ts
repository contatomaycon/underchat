import { Static, Type } from '@sinclair/typebox';

export const blockRoleRequestSchema = Type.Object({
  permission_role_id: Type.String({ format: 'uuid' }),
});

export type BlockRoleRequest = Static<typeof blockRoleRequestSchema>;
