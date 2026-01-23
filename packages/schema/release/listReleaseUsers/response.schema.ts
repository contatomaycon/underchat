import { Static, Type } from '@sinclair/typebox';

export const listReleaseUsersResponseSchema = Type.Array(
  Type.Object({
    user_id: Type.String({ format: 'uuid' }),
    name: Type.String(),
  })
);

export type ListReleaseUsersResponse = Static<
  typeof listReleaseUsersResponseSchema
>;
