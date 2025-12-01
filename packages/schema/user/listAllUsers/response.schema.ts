import { Static, Type } from '@sinclair/typebox';

export const listAllUsersResponseSchema = Type.Object({
  user_id: Type.String({ format: 'uuid' }),
  first_name: Type.Union([Type.String(), Type.Null()]),
  last_name: Type.Union([Type.String(), Type.Null()]),
  account_id: Type.String({ format: 'uuid' }),
  account_name: Type.String(),
});

export type ListAllUsersResponse = Static<typeof listAllUsersResponseSchema>;
