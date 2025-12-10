import { Static, Type } from '@sinclair/typebox';

export const changePasswordResponseSchema = Type.Object({
  success: Type.Boolean({ const: true }),
});

export type ChangePasswordResponse = Static<
  typeof changePasswordResponseSchema
>;
