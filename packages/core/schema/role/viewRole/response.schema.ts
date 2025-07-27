import { Static, Type } from '@sinclair/typebox';

export const viewRoleResponseSchema = Type.Object({
  permission_role_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  account_id: Type.Optional(
    Type.Union([Type.String({ format: 'uuid' }), Type.Null()])
  ),
  created_at: Type.String({ format: 'date-time' }),
});

export type ViewRoleResponse = Static<typeof viewRoleResponseSchema>;
