import { Static, Type } from '@sinclair/typebox';

export const listPermissionRoleAccountParamsRequestSchema = Type.Object({
  account_id: Type.String({ format: 'uuid' }),
});

export type ListPermissionRoleAccountParamsRequest = Static<
  typeof listPermissionRoleAccountParamsRequestSchema
>;

