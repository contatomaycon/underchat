import { Static, Type } from '@sinclair/typebox';

export const viewChatContactPhoneResponseSchema = Type.Object({
  phone: Type.Union([Type.String(), Type.Null()]),
});

export type ViewChatContactPhoneResponse = Static<
  typeof viewChatContactPhoneResponseSchema
>;
