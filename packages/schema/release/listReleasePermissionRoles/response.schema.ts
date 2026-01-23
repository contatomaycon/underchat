import { Static, Type } from '@sinclair/typebox';

export const listReleasePermissionRolesResponseSchema = Type.Array(
  Type.Object({
    id: Type.String({ format: 'uuid' }),
    name: Type.String(),
  })
);

export type ListReleasePermissionRolesResponse = Static<
  typeof listReleasePermissionRolesResponseSchema
>;
