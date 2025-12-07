import { Static, Type } from '@sinclair/typebox';

export const cancelPlanAccountResponseSchema = Type.Object({
  success: Type.Boolean(),
  message: Type.String(),
});

export type CancelPlanAccountResponse = Static<
  typeof cancelPlanAccountResponseSchema
>;
