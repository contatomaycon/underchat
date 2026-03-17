import { Static, Type } from '@sinclair/typebox';

export const cancelAccountAddonResponseSchema = Type.Object({
  success: Type.Boolean(),
  message: Type.String(),
});

export type CancelAccountAddonResponse = Static<
  typeof cancelAccountAddonResponseSchema
>;
