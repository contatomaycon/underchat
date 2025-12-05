import { Static, Type } from '@sinclair/typebox';

export const updateAddressResponseSchema = Type.Object({
  success: Type.Boolean(),
});

export type UpdateAddressResponse = Static<typeof updateAddressResponseSchema>;
