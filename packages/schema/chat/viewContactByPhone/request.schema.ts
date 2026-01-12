import { Static, Type } from '@sinclair/typebox';

export const viewChatContactByPhoneQuerySchema = Type.Object({
  phone: Type.String(),
  phone_ddi: Type.String(),
});

export type ViewChatContactByPhoneQuery = Static<
  typeof viewChatContactByPhoneQuerySchema
>;
