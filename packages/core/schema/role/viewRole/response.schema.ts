import { Static, Type } from '@sinclair/typebox';

export const viewRoleResponseSchema = Type.Object({
  permission_role_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  created_at: Type.String({ format: 'date-time' }),
});

export type ViewRoleResponse = Static<typeof viewRoleResponseSchema>;
