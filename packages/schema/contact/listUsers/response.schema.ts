import { Static, Type } from '@sinclair/typebox';

export const listContactUsersResponseSchema = Type.Object({
  user_id: Type.String({ format: 'uuid' }),
  name: Type.Union([Type.String(), Type.Null()]),
  photo: Type.Union([Type.String(), Type.Null()]),
});

export type ListContactUsersResponse = Static<
  typeof listContactUsersResponseSchema
>;
