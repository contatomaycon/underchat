import { Static, Type } from '@sinclair/typebox';

export const listUserRolesResponseSchema = Type.Array(
  Type.Object({
    id: Type.String({ format: 'uuid' }),
    name: Type.String(),
  })
);

export type ListUserRolesResponse = Static<typeof listUserRolesResponseSchema>;
