import { Static, Type } from '@sinclair/typebox';

export const contactImportStatusSchema = Type.Object({
  phone: Type.String(),
  phone_ddi: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  phone_complete: Type.String(),
  status: Type.Union([
    Type.Literal('valid'),
    Type.Literal('invalid'),
    Type.Literal('error'),
    Type.Literal('duplicate'),
    Type.Literal('no_phone'),
  ]),
  message: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  contact_id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export type ContactImportStatus = Static<typeof contactImportStatusSchema>;
