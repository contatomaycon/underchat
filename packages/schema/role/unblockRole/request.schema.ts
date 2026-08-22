import { Static, Type } from '@sinclair/typebox';

export const unblockRoleRequestSchema = Type.Object({
  permission_role_id: Type.String({ format: 'uuid' }),
});

export type UnblockRoleRequest = Static<typeof unblockRoleRequestSchema>;
