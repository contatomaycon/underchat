import { Static, Type } from '@sinclair/typebox';

export const viewContactByPhoneRequestSchema = Type.Object({
  phone: Type.String(),
  phone_ddi: Type.Optional(Type.String()),
});

export type ViewContactByPhoneRequest = Static<
  typeof viewContactByPhoneRequestSchema
>;
