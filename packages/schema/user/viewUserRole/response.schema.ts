import { Static, Type } from '@sinclair/typebox';

export const viewUserRoleResponseSchema = Type.Object({
  permission_role_id: Type.Union([
    Type.String({ format: 'uuid' }),
    Type.Null(),
  ]),
});

export type ViewUserRoleResponse = Static<typeof viewUserRoleResponseSchema>;
