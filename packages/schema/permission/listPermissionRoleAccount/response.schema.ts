import { Static, Type } from '@sinclair/typebox';

export const listPermissionRoleAccountResponseSchema = Type.Array(
  Type.Object({
    id: Type.String({ format: 'uuid' }),
    name: Type.String(),
  })
);

export type ListPermissionRoleAccountResponse = Static<
  typeof listPermissionRoleAccountResponseSchema
>;

