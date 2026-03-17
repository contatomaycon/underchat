import { Static, Type } from '@sinclair/typebox';

export const listUserRolesRequestSchema = Type.Object({
  account_id: Type.Optional(
    Type.Union([Type.String({ format: 'uuid' }), Type.Null()])
  ),
});

export type ListUserRolesRequest = Static<typeof listUserRolesRequestSchema>;
