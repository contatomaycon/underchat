import { Static, Type } from '@sinclair/typebox';

export const viewContactPhoneResponseSchema = Type.Object({
  phone: Type.Union([Type.String(), Type.Null()]),
});

export type ViewContactPhoneResponse = Static<
  typeof viewContactPhoneResponseSchema
>;
