import { Static, Type } from '@sinclair/typebox';

export const viewRoleRequestSchema = Type.Object({
  permission_role_id: Type.String({ format: 'uuid' }),
});

export type ViewRoleRequest = Static<typeof viewRoleRequestSchema>;
