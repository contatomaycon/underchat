import { Static, Type } from '@sinclair/typebox';
import { EPermissionRoleStatus } from '@core/common/enums/EPermissionRoleStatus';

const roleAccountSchema = Type.Object({
  id: Type.String(),
  name: Type.Union([Type.String(), Type.Null()]),
});

export const viewRoleResponseSchema = Type.Object({
  permission_role_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  description: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  status: Type.String({ enum: Object.values(EPermissionRoleStatus) }),
  account: Type.Optional(Type.Union([roleAccountSchema, Type.Null()])),
  created_at: Type.String({ format: 'date-time' }),
});

export type ViewRoleResponse = Static<typeof viewRoleResponseSchema>;
