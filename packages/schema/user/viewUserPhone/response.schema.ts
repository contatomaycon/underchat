import { Static, Type } from '@sinclair/typebox';

export const viewUserPhoneResponseSchema = Type.Object({
  phone: Type.Union([Type.String(), Type.Null()]),
});

export type ViewUserPhoneResponse = Static<
  typeof viewUserPhoneResponseSchema
>;

