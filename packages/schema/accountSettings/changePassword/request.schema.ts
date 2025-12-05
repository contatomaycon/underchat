import { Static, Type } from '@sinclair/typebox';

export const changePasswordRequestSchema = Type.Object({
  current_password: Type.String({ minLength: 1 }),
  new_password: Type.String({ minLength: 8 }),
});

export type ChangePasswordRequest = Static<typeof changePasswordRequestSchema>;
