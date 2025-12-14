import { Type, Static } from '@sinclair/typebox';

export const reactivatePlanAccountResponseSchema = Type.Object({
  message: Type.String(),
});

export type ReactivatePlanAccountResponse = Static<
  typeof reactivatePlanAccountResponseSchema
>;
