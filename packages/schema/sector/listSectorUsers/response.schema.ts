import { Static, Type } from '@sinclair/typebox';

export const listSectorUsersResponseSchema = Type.Object({
  user_id: Type.String({ format: 'uuid' }),
  email_partial: Type.String(),
  user_info: Type.Optional(
    Type.Object({
      name: Type.Optional(Type.String()),
      last_name: Type.Optional(Type.String()),
    })
  ),
});

export type ListSectorUsersResponse = Static<
  typeof listSectorUsersResponseSchema
>;
