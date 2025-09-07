import { Static, Type } from '@sinclair/typebox';

const roleAccountSchema = Type.Object({
  id: Type.String(),
  name: Type.Union([Type.String(), Type.Null()]),
});

export const viewRoleResponseSchema = Type.Object({
  permission_role_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  account: Type.Optional(Type.Union([roleAccountSchema, Type.Null()])),
  created_at: Type.String({ format: 'date-time' }),
});

export type ViewRoleResponse = Static<typeof viewRoleResponseSchema>;
