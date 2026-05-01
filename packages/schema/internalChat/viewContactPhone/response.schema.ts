import { Static, Type } from '@sinclair/typebox';

export const viewInternalChatContactPhoneDataSchema = Type.Object({
  phone: Type.Union([Type.String(), Type.Null()]),
  phone_ddi: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export const viewInternalChatContactPhoneResponseSchema = Type.Object({
  id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  status: Type.Boolean({ const: true }),
  message: Type.String(),
  data: viewInternalChatContactPhoneDataSchema,
});

export type ViewInternalChatContactPhoneResponse = Static<
  typeof viewInternalChatContactPhoneResponseSchema
>;
