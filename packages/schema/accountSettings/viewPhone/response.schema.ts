import { Static, Type } from '@sinclair/typebox';

export const viewPhoneResponseSchema = Type.Object({
  phone: Type.Union([Type.String(), Type.Null()]),
});

export type ViewPhoneResponse = Static<typeof viewPhoneResponseSchema>;
