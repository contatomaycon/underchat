import { Static, Type } from '@sinclair/typebox';

const labelTemplateSchema = Type.Object({
  label_template_id: Type.String({ format: 'uuid' }),
  label: Type.String(),
  color: Type.String(),
});

const contactDocumentTypeSchema = Type.Object({
  contact_document_type_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
});

export const viewChatContactResponseSchema = Type.Object({
  contact_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  last_name: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  email_partial: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  phone_ddi: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  phone_partial: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  nickname: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  birthday: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  notes: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  document: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  document_partial: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  photo: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  is_valided: Type.Optional(Type.Union([Type.Boolean(), Type.Null()])),
  label_template: Type.Optional(Type.Union([labelTemplateSchema, Type.Null()])),
  contact_document_type: Type.Optional(
    Type.Union([contactDocumentTypeSchema, Type.Null()])
  ),
});

export type ViewChatContactResponse = Static<
  typeof viewChatContactResponseSchema
>;
