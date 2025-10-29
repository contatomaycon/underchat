import { Static, Type } from '@sinclair/typebox';

export const deleteUserRequestSchema = Type.Object({
  user_id: Type.String({ format: 'uuid' }),
});

export type DeleteUserRequest = Static<typeof deleteUserRequestSchema>;
