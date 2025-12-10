import { Static, Type } from '@sinclair/typebox';

export const updateAdditionalInfoResponseSchema = Type.Object({
  success: Type.Boolean(),
});

export type UpdateAdditionalInfoResponse = Static<
  typeof updateAdditionalInfoResponseSchema
>;
